"use strict";

var utils = require(__dirname + '/lib/utils'),
    util = require('util'),
    eventEmitter = require('events').EventEmitter,
    serialPortModul = require("serialport"),
    soef = require('soef'),
    devices = new soef.Devices();

var WMB = require('wm-bus'),
    WMBUS = WMB.WMBUS;

var com = null;

var adapter = utils.adapter({
    name: 'wm-bus',
    
    unload: function (callback) {
        adapter.log.info("going down...");
        try {
            if (com) {
                com.close();
                com = null;
            }
            callback();
        } catch (e) {
            callback();
        }
    },
    //discover: function (callback) {
    //},
    //install: function (callback) {
    //},
    //uninstall: function (callback) {
    //},
    //objectChange: function (id, obj) {
    //},
    //stateChange: function (id, state) {
    //},
    message: onMessage,
    ready: function () {
        devices.init(adapter, function(err) {
            main();
        });
    }
});


function onMessage (obj) {
    if (!obj || !obj.command || !obj.callback) {
        return;
    }
    var timer = setTimeout(function() {
        timer = null;
        adapter.sendTo(obj.from, obj.command, '[]', obj.callback);
    }, 2000);
    switch (obj.command) {
        case 'discovery':
            if (!serialPortModul) return;
            serialPortModul.list(function (err, ports) {
                if (!err && ports) {
                    ports.forEach(function(v) {
                        if (!v.manufacturer) v.manufacturer = 'n/a';
                    });
                    if (!timer) return;
                    clearTimeout(timer);
                    adapter.sendTo(obj.from, obj.command, JSON.stringify(ports), obj.callback);
                }
            });
            break;
        default:
            break;
    }
}


var Com = function (options, callback) {
    eventEmitter.call(this);
    util._extend(this, WMB.WMBUSController);
    var that = this;
    var spOptions = {};

    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    this.wmbus = new WMBUS({log: adapter.log, formatDate: adapter.formatDate});
    for (var i=0; i < adapter.config.devices.length; i++) {
        var configDevice = adapter.config.devices[i];
        this.wmbus.addAESKey(configDevice.manufacturerId, configDevice.aesKey);
    }
    //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    var unpack = this.wmbus.unpack;
    this.msgReceived = 0;

    //options.init = 0;
    //if (options.cul) {
    //    spOptions.baudrate = 9600;
    //    spOptions.parser = serialPortModul.parsers.readline('\r\n');
    //} else {
    //    spOptions.baudrate = 57600;
    //}
    this.prepare(spOptions);
    if (options.baudrate) spOptions.baudrate = options.baudrate;

    var serialPort = new serialPortModul.SerialPort(options.serialport, spOptions);

    this.close = function (callback) {
        if (!serialPort) return;
        callback = callback || function() {};
        //if (options.init && stopCmd) {
        //    that.write(stopCmd, function () {
        //        serialPort.close(callback);
        //    });
        //} else {
            serialPort.close(callback);
            serialPort = null;
        //}
        serialPort = null;
    };

    this.write = function send(data, callback) {
        if(serialPort) serialPort.write(data, callback);
    };

    serialPort.on('error', function (err) {
        adapter.log.error('Error: ' + err.message);
    });
    serialPort.on('close', function () {
        if (serialPort) {
            this.emit('close');
        }
    });

    serialPort.on("open", function () {

        serialPort.on('data', that.onData.bind(that));
        that.init(callback);

    });

    var incnt = 0;

    function getLong(arr, offset) {
        return arr[offset+3] << 24 + arr[offset+2] << 16 + arr[offset+1] << 8 + arr[offset+0];
    }

    this.decodeiM871A = function (data, dataStr) {

        var length;
        var eid = data[that.CF_EID];
        var header = {
            endPointId: (eid & 0x0F),
            mid: data[that.MID],
            payloadLength: data[that.LENGTH],

            b_timeStamp: ((eid & 0x20) >> 0) !== 0,
            b_rssi:      ((eid & 0x40) >> 0) !== 0,
            b_crc16:     ((eid & 0x80) >> 0) !== 0,
            length:      data[that.LENGTH] + that.OFFSETPAYLOAD,
            timeStamp: 0,
            rssi: 0
        };
        if (header.b_timeStamp) {
            header.timeStamp = getLong(data, 3+header.payloadLength);
        }
        if (header.b_rssi) {
            var rssi = data[7+header.payloadLength];
            const b = -100.0 - (4000.0 / 150.0);
            const m = 80.0 / 150.0;
            header.rssi = parseInt(m * rssi + b);
        }

        switch (header.endPointId) {
            case that.RADIOLINK_ID: // WM-Bus Data
                if (header.mid == that.RADIOLINK_MSG_WMBUSMSG_IND) {
                    length = data[that.LENGTH] + that.OFFSETPAYLOAD + (header.timeStamp ? 4 : 0) + (header.rssi ? 1 : 0) + (header.crc16 ? 2 : 0);
                    that.msgReceived++;
                    that.wmbus.crcRemoved = true;
                    if (incnt++ > 0) {
                        adapter.log.error("Incount > 1 " + incnt + 1);
                    }
                    that.wmbus.parse(dataStr.substr(3));
                    incnt--;
                }
                break;
            case that.DEVMGMT_ID:   // Command Answer
                switch (header.mid) {
                    case that.DEVMGMT_MSG_AES_DEC_ERROR_IND:
                        length = data[that.LENGTH] + that.OFFSETPAYLOAD + ((that.CF_TIMESTAMP(data[that.CF_EID]) > 0) ? 4 : 0) + ((that.CF_RSSI(data[that.CF_EID]) > 0) ? 1 : 0) + ((that.CF_CRC16(data[that.CF_EID]) > 0) ? 2 : 0);
                        break;
                    case that.DEVMGMT_MSG_GET_DEVICEINFO_RSP:
                        //length = 8?
                        that.deviceInfo = {};
                        unpack("CmoduleType/CdeviceMode/CfirmwareVersion/LdeviceID/",
                            dataStr.substr(4),
                            that.deviceInfo
                        );
                        break;
                    case that.DEVMGMT_MSG_GET_CONFIG_RSP:
                        //length = 8?
                        that.deviceConfig = { };
                        unpack("CiIFlag/CdeviceMode/ClinkMode/Cwmbus_cField/nwmbus_manID/Lwmbus_deviceID/Cwmbus_version/Cwmbus_deviceType/cradioChannel/CiIFlag2/CradioPowerLevel/CradioDataRate/CradioRXWindow/CautoPowerSaving/CautoRSSIAttachment/CautoRXTimestampAttachment/CledControl/CrtcControl",
                            dataStr.substr(4),
                            that.deviceConfig
                        );
                        break;
                    case that.DEVMGMT_MSG_GET_SYSSTATUS_RSP:
                        //length = 38
                        that.sysStatus = {};
                        unpack("CnvmStatus/LsystemTick/Lreserved1/Lreserved2/LnumTXFrames/LnumTXErrors/LnumRXFrames/LnumRxCRCErrors/LnumRxPhyErrors/Lreserved3",
                            dataStr.substr(4),
                            that.sysStatus);
                        break;
                    case that.DEVMGMT_MSG_SET_CONFIG_RSP:

                        break;
                    default:
                        length = data[that.LENGTH] + that.OFFSETPAYLOAD;
                        break;
                }
                break;
        }
    };

    return this;
};

Com.prototype.prepare = function(spOptions) {
    spOptions.baudrate = 57600;
};

Com.prototype.init = function (callback) {
    var that = this;
    that.getConfig(function (err) {
        setTimeout(function () {
            that.initStick();
            if ((that.hasOwnProperty('deviceConfig')) && (that.deviceConfig.linkMode != 3)) {
                that.initStick();
                //??? xxxxxxx
            }
            if (callback) callback(soef.hasProp(that, 'deviceConfig.linkMode'));
        }, 5000);
        that.getInfo(function (err) {
            that.getSysStatus(function (err) {
                if(callback) callback();
            });
        });
    });
};

Com.prototype.onData = function (data) {
    if(this.START_OF_FRAME == data[this.SOF]) {  // iM871A   dwReturn = IMST
        var dataStr = data.toString('binary');
        adapter.log.debug("raw: " + this.wmbus.unpack('H*', dataStr));
        this.decodeiM871A (data, dataStr);
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var CulCom = function (_wmbus, options, callback) {
    Com.call(this, _wmbus, options, callback);
};

CulCom.prototype.prepare = function(spOptions) {
    spOptions.baudrate = 9600;
    spOptions.parser = serialPortModul.parsers.readline('\r\n');
};

CulCom.prototype.init = function (callback) {
    var that = this;
    that.write('X21\r\nbrt', function () {
        setTimeout(function () {
            if (callback) callback(that.tmode == true);
        }, 2000)
    });
};

CulCom.prototype.decode = function(data) {
    if (data.indexOf('b4') == 0) {
        var d ='';
        data.substr(1).match(/(..)/g).forEach (function(v) {
            d += String.fromCharCode(parseInt(v, 16));
        });
        this.wmbus.parse(d);
    }
};

CulCom.prototype.onData = function (data) {
    if(typeof data == 'string' && data[0] == 'b') {
        adapter.log.debug('raw: ' + data);
        this.decode(data);
    } else if (data.length >= 2 && data[0] == 98) {
        this.decode(data);
    } else {
        if (typeof data == 'string' && data.indexOf('TMODE' == 0)) {
            this.tmode = true;
        } else if (data[0]==84 && data[1]==77 && data[2]==79 && data[3]==68 && data[4]==69) { // TMODE
            this.tmode = true;
        }
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

//function CWMBusDevice(name, showName) {
//    //if (!(this instanceof CWMBusDevice)) {
//    //    return new CWMBusDevice(_name, showName, list);
//    //}
//    //var me = devices.CDevice.call(this, name, showName);
//    //util._extend(this, devices.CDevice);
//    //fullExtend(this, devices.CDevice);
//    fullExtend(this, devices.CDevice.call(this, name, showName));
//
//    this.updateState = function (data, value) {
//        var channel = /*data.number.toString() + '-' +*/ data.type;
//        if (data.hasOwnProperty('extension')) {
//            channel += '-' + data.extension.replace(', ', '');
//        }
//        this.setChannel(data.number.toString(), channel);
//        for (var i in data) {
//            switch (i) {
//                //case 'type':
//                case 'unit':
//                case 'value':
//                //case 'extension':
//                //case 'functionFieldText':
//                    if (data[i]) {
//                        this.set(i, data[i]);
//                    }
//            }
//        }
//        switch (data.type || "") {
//            case 'VIF_ELECTRIC_POWER_PHASE_NO':
//            case 'VIF_ELECTRIC_POWER_PHASE':
//            case 'VIF_ELECTRIC_POWER':
//                var s = formatValue(data.value, 2) + ' ' + data.unit;
//                //this.set('valueString', s);
//                this.set('', s);
//                break;
//            case 'VIF_ENERGY_WATT':
//                var s = formatValue(data.value / 1000, 2) + ' k' + data.unit;
//                //this.set('valueString', s);
//                this.set('', s);
//                break;
//
//        }
//    }
//}

function newCDevice(name, showName) {

    devices.CDevice.prototype.updateState = function (data, value) {
        var channel = /*data.number.toString() + '-' +*/ data.type;
        if (data.hasOwnProperty('extension')) {
            channel += '-' + data.extension.replace(', ', '');
        }
        this.setChannel(data.number.toString(), channel);
        for (var i in data) {
            switch (i) {
                //case 'type':
                case 'unit':
                case 'value':
                    //case 'extension':
                    //case 'functionFieldText':
                    if (data[i]) {
                        this.set(i, data[i]);
                    }
            }
        }
        switch (data.type || "") {
            case 'VIF_ELECTRIC_POWER_PHASE_NO':
            case 'VIF_ELECTRIC_POWER_PHASE':
            case 'VIF_ELECTRIC_POWER':
                var s = formatValue(data.value, 2) + ' ' + data.unit;
                //this.set('valueString', s);
                this.set('', s);
                break;
            case 'VIF_ENERGY_WATT':
                var s = formatValue(data.value / 1000, 2) + ' k' + data.unit;
                //this.set('valueString', s);
                this.set('', s);
                break;

        }
    };
    return new devices.CDevice(name, showName);
}

//var tries = 0,
//    lastError = 0;

WMBUS.prototype.updateStates = function(){

    if (this.errorcode === this.cc.ERR_NO_ERROR) {
        //if (!this.dev) this.dev = new CWMBusDevice(name, this.typestring);
        if (!this.dev) this.dev = newCDevice(); //newCDevice(name, this.typestring);
        var name = this.manufacturer + '-' + this.afield_id;
        var dev = this.dev; //new CWMBusDevice(name, this.typestring);
        dev.setDevice(name, this.typestring);
        dev.set('encryptionMode', this.encryptionMode);
        dev.set('lastUpdate', adapter.formatDate(new Date(), "YYYY-MM-DD hh:mm:ss"));
        for (var i = 0; i < this.datablocks.length; i++) {
            dev.updateState(this.datablocks[i])
        }
        //dev.update();
    } else {
        if (this.lastError !== this.errorcode)
        {
            this.lastError = this.errorcode;
            adapter.log.error("Error Code: " + this.errorcode + " " + this.errormsg);
        }
        //this.tries >>= 0;
        if (this.tries == undefined) this.tries = 0;
        if (this.tries < 5) {
            this.checkConfiguration ();
            this.tries++;
        }
    }
    devices.root.set('errorcode', this.errorcode);
    devices.root.set('errormsg', this.errormsg);
    devices.root.update();
};


function setConfigDevice (idx, configDevice) {
    adapter.getForeignObject("system.adapter." + adapter.namespace, function (err, obj) {
        obj.native.devices[idx] = configDevice;
        adapter.setForeignObject(obj._id, obj, {}, function (err, obj) {
            console.log("");
        });
    });
}

WMBUS.prototype.checkConfiguration = function () {
    if (adapter.config.devices.length > 7) return;

    var found = -1, exact = false;
    var foundDevice = { aesKey: "" };

    for (var idx = 0; idx < adapter.config.devices.length; idx++) {
        var configDevice = adapter.config.devices[idx];
        if (configDevice.manufacturerId == this.afield_id) {
            found = idx;
            foundDevice = configDevice;
            if (configDevice.version == this.afield_ver && configDevice.type == this.afield_type) {
                exact = true;
                break;
            }
        }
    }
    if (!exact) {
        idx = found != -1 ? found : adapter.config.devices.length;
        foundDevice.manufacturerId = this.afield_id; // '60092596';
        foundDevice.version = this.afield_ver;       // 6
        foundDevice.type = this.afield_type;         // 2
        setConfigDevice(idx, foundDevice);
    }
};


function main() {

    if (!adapter.config.comPort) return;

    com = new CulCom({serialport: adapter.config.comPort}, function(isCul) {
        if (isCul) return;
        com.close();
        com = new Com({serialport: adapter.config.comPort}, function(is) {
        });
    });
    //adapter.subscribeStates('*');
}




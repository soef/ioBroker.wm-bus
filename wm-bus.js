"use strict";

var utils = require(__dirname + '/lib/utils'),
    util = require('util'),
    eventEmitter = require('events').EventEmitter,
    serialPortModul = require("serialport");

var soef = require(__dirname + '/lib/soef'),
    devices = new soef.Devices();

var WMB = require('wm-bus'),
    WMBUSController = WMB.WMBUSController,
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
    discover: function (callback) {
    },
    install: function (callback) {
    },
    uninstall: function (callback) {
    },
    objectChange: function (id, obj) {
    },
    stateChange: function (id, state) {
    },
    message: onAdapterMessage,
    ready: function () {
        devices.init(adapter, function(err) {
            main();
        });
    }
});


function onAdapterMessage (obj) {
    if (!obj || !obj.command) {
        return;
    }
    switch (obj.command) {
        case 'listUart':
            if (!obj.callback) {
                return;
            }
            if (serialPortModul) {
                serialPortModul.list(function (err, ports) {

                    adapter.log.info('List of port: ' + JSON.stringify(ports));
                    adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                });
            } else {
                adapter.log.warn('Module serialport is not available');
                adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
            }
            break;
    }
}


var Com = function (_wmbus, options) {
    eventEmitter.call(this);
    util._extend(this, WMBUSController);
    var that = this;
    var unpack = _wmbus.unpack;

    this.wmbus = _wmbus;
    this.msgReceived = 0;

    options.init = 0;

    var spOptions = { baudrate: options.baudrate };
//    sp.open(portName,{
//            52 baudRate: 9600, 
//            53 dataBits: 8, 
//            54 parity: 'none', 
//            55 stopBits: 1, 
//            56 flowControl: false 
//    57
//}); 

    //spOptions.parser = serialPortModul.parsers.readline('\r\n');
    var serialPort = new serialPortModul.SerialPort(options.serialport, spOptions);


    this.close = function (callback) {
        if (!serialPort) return;
        callback = callback || function() {};
        if (options.init && stopCmd) {
            that.write(stopCmd, function () {
                serialPort.close(callback);
            });
        } else {
            serialPort.close(callback);
        }
        serialPort = null;
    };

    serialPort.on('close', function () {
        if (serialPort) {
            this.emit('close');
        }
    });

    serialPort.on("open", function () {

        that.getConfig(function (err) {
            setTimeout(function () {
                if ((that.hasOwnProperty('deviceConfig')) && (that.deviceConfig.linkMode != 3)) {
                    //that.initStick();
                }
            }, 5000);

            that.getInfo(function (err) {
                that.getSysStatus(function (err) {
                });
            });
        });

        serialPort.on('data', function (data) {

            var dataStr = data.toString('binary');
            adapter.log.debug("raw: " + unpack('H*', dataStr));

            if(that.START_OF_FRAME == data[that.SOF]) {  // iM871A   dwReturn = IMST
                that.decodeiM871A (data, dataStr);
            }
        });

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

    this.write = function send(data, callback) {
        serialPort.write(data, callback);
    };

    return this;
};


function CDevice(name, showName) {
    devices.CDevice.call(this, name, showName);

    this.updateState = function (data, value) {
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
    }
}

var tries = 0,
    lastError = 0;

WMBUS.prototype.updateStates = function(){

    if (this.errorcode === this.cc.ERR_NO_ERROR) {
        var name = this.manufacturer + '-' + this.afield_id;
        var dev = new CDevice(name, this.typestring);
        dev.set('encryptionMode', this.encryptionMode);
        dev.set('lastUpdate', adapter.formatDate(new Date(), "YYYY-MM-DD hh:mm:ss"));
        for (var i = 0; i < this.datablocks.length; i++) {
            dev.updateState(this.datablocks[i])
        }
        //dev.update();
    } else {
        if (lastError !== this.errorcode)
        {
            lastError = this.errorcode;
            adapter.log.error("Error Code: " + this.errorcode + " " + this.errormsg);
        }
        if (tries < 5) {
            this.checkConfiguration ();
            tries++;
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

    var wmbus = new WMBUS({log: adapter.log, formatDate: adapter.formatDate});
    //for (var configDevice of adapter.config.devices) {
    //    wmbus.addAESKey(configDevice.manufacturerId, configDevice.aesKey);
    //}
    for (var i=0; i < adapter.config.devices.length; i++) {
        var configDevice = adapter.config.devices[i];
        wmbus.addAESKey(configDevice.manufacturerId, configDevice.aesKey);
    }
    com = new Com(wmbus, {serialport: adapter.config.comPort, baudrate: 57600, init: 0});

    //adapter.subscribeStates('*');
}




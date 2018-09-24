"use strict";

var utils = require(__dirname + '/lib/utils'),
    util = require('util'),
    eventEmitter = require('events').EventEmitter,
    serialPortModule = require('serialport'),
    soef = require('soef'),
    devices = new soef.Devices();

var WMB = require('wm-bus'),
    WMBUS = WMB.WMBUS;

var com = null;

var adapter = utils.Adapter({
    name: 'wm-bus',

    unload: function (callback) {
        soef.safeFunction(adapter, 'log.info') ("going down...");
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
            if (!serialPortModule) return;
            serialPortModule.list(function (err, ports) {
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


function findComPort() {
    if (!serialPortModule) return;
    serialPortModule.list(function (err, ports) {
        function doIt() {
            if (ports.length <= 0) return;
            var p = ports.pop();
            run(p.comName, function (res) {
                if (!res) return doIt();
                changeConfig (function (config) {
                    config.comPort = p.comName;
                    return true;
                });
            });
        }
        if (!err && ports) doIt();
    })
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

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

    this.prepare(spOptions);
    if (options.baudRate) spOptions.baudRate = parseInt(options.baudRate,10);

    var serialPort = new serialPortModule (options.serialport, spOptions);
    if (this.parser) {
        this.parser = serialPort.pipe(this.parser);
    }


    this.close = function (callback) {
        if (!serialPort) return;
        callback = callback || function() {};
        serialPort.close(callback);
        serialPort = null;
    };

    this.write = function send(data, callback) {
        if(serialPort) {
            serialPort.write(data, function (err) {
                //console.log('write callback: ' + data.toString() + err);
                //callback(err, data);
            });
            serialPort.drain(callback);
        }
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
        that.parser ? that.parser.on('data', that.onData.bind(that)) : serialPort.on('data', that.onData.bind(that));
        that.init(callback);
    });

    var inCnt = 0;

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
            var b = -100.0 - (4000.0 / 150.0);
            var m = 80.0 / 150.0;
            header.rssi = parseInt(m * rssi + b);
        }

        switch (header.endPointId) {
            case that.RADIOLINK_ID: // WM-Bus Data
                if (header.mid === that.RADIOLINK_MSG_WMBUSMSG_IND) {
                    length = data[that.LENGTH] + that.OFFSETPAYLOAD + (header.timeStamp ? 4 : 0) + (header.rssi ? 1 : 0) + (header.crc16 ? 2 : 0);
                    that.msgReceived++;
                    that.wmbus.crcRemoved = true;
                    if (inCnt++ > 0) {
                        adapter.log.error("inCnt > 1 " + inCnt + 1);
                    }
                    that.wmbus.parse(dataStr.substr(3));
                    inCnt--;
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
    spOptions.baudRate = 57600;
};

Com.prototype.init = function (callback) {
    var that = this;
    that.getConfig(function (err) {
        setTimeout(function () {
            that.initStick(function () {
                that.getInfo(function (err) {
                    that.getSysStatus(function (err) {
                        if ((that.hasOwnProperty('deviceConfig')) && (that.deviceConfig.linkMode !== that.LINKMODE_T1)) {
                            that.initStick();
                            //??? xxxxxxx
                        }
                        if (callback) callback(soef.hasProp(that, 'deviceConfig.linkMode') ? 'iM871A' : undefined);

                    });
                });
            });
        }, 2000);
    });
};

Com.prototype.onData = function (data) {
    if(this.START_OF_FRAME === data[this.SOF]) {  // iM871A   dwReturn = IMST
        var dataStr = data.toString('binary');
        adapter.log.debug("raw: " + this.wmbus.unpack('H*', dataStr));
        this.decodeiM871A (data, dataStr);
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var CulCom = function (options, callback) {
    Com.call(this, options, callback);
};

CulCom.prototype.prepare = function(spOptions) {
    spOptions.baudRate = 9600;
    this.parser = new serialPortModule.parsers.Readline({delimiter: '\r\n'});
};

CulCom.prototype.init = function (callback) {
    var that = this;
    that.write('X21\r\nbrt', function () {
        setTimeout(function () {
            if (callback) callback(that.tmode === true ? 'cul' : undefined);
        }, 2000)
    });
};

// CulCom.prototype.decode = function(data) {
//     if (data.indexOf('b4') === 0) {
//         var d ='';
//         data.substr(1).match(/(..)/g).forEach (function(v) {
//             d += String.fromCharCode(parseInt(v, 16));
//         });
//         this.wmbus.parse(d);
//     }
// };
//
// CulCom.prototype.onData = function (data) {
//     if(typeof data === 'string' && data[0] === 'b') {
//         adapter.log.debug('raw: ' + data);
//         this.decode(data);
//     } else if (data.length >= 2 && data[0] === 98) {
//         this.decode(data);
//     } else {
//         if (typeof data === 'string' && data.indexOf('TMODE' === 0)) {
//             this.tmode = true;
//         } else if (data[0]===84 && data[1]===77 && data[2]===79 && data[3]===68 && data[4]===69) { // TMODE
//             this.tmode = true;
//         }
//     }
// };

CulCom.prototype.onData = function (data) {
    if (typeof data !== 'string') return; // with ReadLine parser, data will be a string
    if(data.length >=2 && data[0] === 'b' /*98*/ && data[1] === '4' /*52*/) {   // === 'b4'
        var binString = '';
        for (var i=1, len=data.length; i+1 < len; i+=2) {
            binString += String.fromCharCode(parseInt(data[i] + data[i+1], 16))
        }
        // data.substr(1).match(/(..)/g).forEach (function(v) {
        //     binString += String.fromCharCode(parseInt(v, 16));
        // });
        this.wmbus.parse(binString);
        adapter.log.debug('raw: ' + data);
    } else {
        if (data === 'TMODE') {
            //if (data[0]===84 && data[1]===77 && data[2]===79 && data[3]===68 && data[4]===69) { // === 'TMODE'
            this.tmode = true;
            adapter.log.debug('TMODE detected and tmode set to true')
        }
    }
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var AmberCom = function (options, callback) {
    Com.call(this, options, callback);
};

AmberCom.prototype.prepare = function(spOptions) {
    spOptions.baudRate = 9600;
    this.parser = '';
};

AmberCom.prototype.init = function (callback) {
    var that = this;
    this.frameBuffer = false;
    this.telegramLength = -1;
    callback('amber');
};

AmberCom.prototype.onData = function (data) {
    if (!Buffer.isBuffer(data)) {
        adapter.log.debug('Unkown data received');
        adapter.log.debug(JSON.stringify(data));
        return;
    }
    if (data[0] === 0xFF) { // start of telegram
        this.frameBuffer = data;
        if (this.frameBuffer.byteLength > 2) {
            this.telegramLength = data[2] + 4;
        } else {
            this.telegramLength = -1;
            return;
        }
    } else {
        this.frameBuffer = this.frameBuffer ? Buffer.concat([this.frameBuffer, data]) : data;
    }

    if ((this.telegramLength === -1) && (this.frameBuffer.byteLength > 2)) {
        this.telegramLength = data[2] + 4;
    }
    if (this.telegramLength === -1) {
        return;
    }

    if (this.telegramLength <= this.frameBuffer.byteLength) {
        adapter.log.debug('telegram received: ' + this.frameBuffer.toString('hex'));
        this.wmbus.crcRemoved = true;
        this.wmbus.parse(this.frameBuffer.toString('hex', 2, this.telegramLength - 2));
        this.telegramLength = -1;
        this.frameBuffer = false;
    }
};


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
                this.set('', s);
                break;
            case 'VIF_ENERGY_WATT':
                var s = formatValue(data.value / 1000, 2) + ' k' + data.unit;
                this.set('', s);
                break;

        }
    };
    return new devices.CDevice(name, showName);
}

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
    } else {
        if (this.lastError !== this.errorcode)
        {
            this.lastError = this.errorcode;
            adapter.log.error("Error Code: " + this.errorcode + " " + this.errormsg);
        }
        if (this.tries === undefined) this.tries = 0;
        if (this.tries < 5) {
            this.checkConfiguration ();
            this.tries++;
        }
    }
    devices.root.set('errorcode', this.errorcode);
    devices.root.set('errormsg', this.errormsg);
    devices.root.update();
};

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//has to be moved to soef lib
function changeAdapterConfig (_adapter, changeCallback, doneCallback) {
    _adapter.getForeignObject("system.adapter." + _adapter.namespace, function (err, obj) {
        if (!err && obj && !obj.native) obj['native'] = {};
        if (!err && obj && changeCallback(obj.native) !== false) {
            _adapter.setForeignObject(obj._id, obj, {}, function (err, obj) {
                console.log("config changed");
                if (doneCallback) doneCallback(err, obj);
            });
        }
    });
}

function changeConfig(changeCallback, doneCallback) {
    return changeAdapterConfig(adapter, changeCallback, doneCallback)
}
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

WMBUS.prototype.checkConfiguration = function () {
    if (adapter.config.devices.length > 7) return;
    if (!this.afield_id) return;

    var found = -1, exact = false;
    var foundDevice = { aesKey: "" };

    for (var idx = 0; idx < adapter.config.devices.length; idx++) {
        var configDevice = adapter.config.devices[idx];
        if (configDevice.manufacturerId === this.afield_id) {
            found = idx;
            foundDevice = configDevice;
            if (configDevice.version === this.afield_ver && configDevice.type === this.afield_type) {
                exact = true;
                break;
            }
        }
    }
    if (!exact) {
        idx = found !== -1 ? found : adapter.config.devices.length;
        foundDevice.manufacturerId = this.afield_id; // '60092596';
        foundDevice.version = this.afield_ver;       // 6
        foundDevice.type = this.afield_type;         // 2
        changeConfig (function(config) {
            config.devices[idx] = foundDevice;
        });
    }
};

function run(comPort, cb) {
    var coms = [CulCom, AmberCom, Com];
    if (adapter.config.type === 'iM871A') {
        coms.unshift(coms.pop());
    }
    com = new coms[0]({serialport: comPort}, function (res) {
        if (res) return cb && cb(res);
        com.close();
        setTimeout(function() {
            com = new coms[1]({serialport: comPort}, function (res) {
                cb && cb(res);
            });
        }, 2000);
    });
}


function main() {

    if (!adapter.config.comPort) {
        findComPort();
        return;
    }

    run(adapter.config.comPort, function(type) {
       if (type !== adapter.config.type) {
           changeConfig(function(config) {
               config.type = type;
               return true;
           })
       }
    });
    //adapter.subscribeStates('*');
}

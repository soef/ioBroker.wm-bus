"use strict";

var utils = require(__dirname + '/lib/utils');
var crypto = require('crypto');

var soef = require(__dirname + '/lib/soef'),
    devices = soef.Devices();

var adapter = utils.adapter({
    name: 'wm-bus',
    
    unload: function (callback) {
        try {
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
    //    //adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
    //},
    //stateChange: function (id, state) {
    //    //adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
    //},
    //ready: function () {
    //    main();
    //}
    ready: main
});


var wmbus;

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var CRC = function () {
    this.polynom = 0x3D65;
    this.initValue = 0;
    this.xor = 0xffff;
    //this.bytes = 2;
    this.table = [];
    for (var i = 0; i < 256; i++) {
        var r = i << 8;
        for (var j = 0; j < 8; j++) {
            if (r & (1 << 15)) {
                r = (r << 1) ^ this.polynom;
            } else {
                r = (r << 1);
            }
        }
        this.table[i] = r;
    }
}

CRC.prototype.build = function (data) {
    //var isString = typeof (data) == 'string';
    //if (!isString && data.constructor == ArrayBuffer) {
    //    data = new Uint8Array(data);
    //}
    var crc = this.initValue;
    
    for (var i = 0; i < data.length; ++i) {
        var code = data.charCodeAt(i);
        crc = this.table[((crc >> 8) ^ code) & 0xFF] ^ (crc << 8);
    }
    crc ^= this.xor;
    crc &= 0xffff;
    return crc;
}

var crc = new CRC();

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var SerialPortModule = require("serialport");
var SerialPort = SerialPortModule.SerialPort;


function main () {
	devices.init(adapter, function(err) {

       //var com = new Com({});

	})
}


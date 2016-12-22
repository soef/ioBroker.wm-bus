![Logo](admin/wm-bus.png)
### ioBroker.wm-bus			   

[![NPM version](http://img.shields.io/npm/v/iobroker.wm-bus.svg)](https://www.npmjs.com/package/iobroker.wm-bus)
[![Tests](http://img.shields.io/travis/soef/ioBroker.wm-bus/master.svg)](https://travis-ci.org/soef/ioBroker.wm-bus)
[![Build status](https://ci.appveyor.com/api/projects/status/xg29a1r5dl00dq23?svg=true)](https://ci.appveyor.com/project/soef/iobroker-wm-bus)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat)](https://github.com/soef/iobroker.wm-bus/blob/master/LICENSE)

***This adapter requires at least Node 4.4***

#### Description

Adapter for Wireless M-Bus

#### Info

Supported USB Adapters:

+ [iM871A](http://www.wireless-solutions.de/products/gateways/wirelessadapter)
+ [CUL](http://shop.busware.de/product_info.php/products_id/29?osCsid=eab2ce6ef5efc95dbdf61396ca256b6e)

#### Configuration

If used, an AES key to decrypt the message.
Manufacture ID, type and version will be determined after the first received message

#### Installation
Execute the following command in the iobroker root directory (e.g. in /opt/iobroker)
```
npm install iobroker.wm-bus 
```

#### Requirements

+ an [iM871A](http://www.wireless-solutions.de/products/gateways/wirelessadapter) USB Stick
+ or a [CUL](http://shop.busware.de/product_info.php/products_id/29?osCsid=eab2ce6ef5efc95dbdf61396ca256b6e) USB Stick
+ a WM-Bus Device e.g. [EasyMeter](http://www.easymeter.com/)
<!--
### License
The MIT License (MIT)

Copyright (c) 2016 soef <soef@gmx.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
-->
process.on('uncaughtException', error => {
	console.error('uncaughtException', error);
});

process.on('unhandledRejection', error => {
	console.error('unhandledRejection', error);
 });

const http = require('http');
const noble = require('@abandonware/noble');
const axios = require('axios');
const fs = require('fs');
const YAML = require('yaml');

//to override the default config, copy config.yaml.sample to config.yaml and edit as needed
const config = fs.existsSync("./config.yaml") 
	? YAML.parse(fs.readFileSync("./config.yaml", "utf8"))
	: {
		http: { port: 8123 },  //HTTP port to listen on
		log: { level: 1 }, //0:minimal, 1:add connection info, 2:add tasks, 3:add command processing
		serta: { 
			scan_timeout: 5000, //5 seconds 
			check_interval: 60000  //1 minute 
		}
	};

//base configuration
const httpPort = config.http.port;
const loglevel = config.log.level;

// shoudln't need to edit below here

const appState = {
	scanning: false,
	task: {
		current: null,
		queue: [],
	},
	timers: {},
	timeout: config.serta.scan_timeout, 
	checkInterval: config.serta.check_interval,
};

//UUIDs found via noble's scan examples.
const serviceUUIDs = ["0003cbbb00001000800000805f9b0131"];
const characteristicUUIDs = ["0003cbb100001000800000805f9b0131"];

http.createServer(function (req, res) {
	if (req.method == 'POST') {
		log(3, 'http POST started')
		let body = ''
		req.on('data', function (data) {
			body += data
		})
		req.on('end', async function () {
			log(3, 'request: ' + body);
			res.writeHead(200, { 'Content-Type': 'text/html' })
			res.end('post received')
			let data = JSON.parse(body); //should be an array of commands
			appState.task.queue.push(...data);
			nextTask();
		})
	} else {
		log(3, 'http GET started');
		let html = `
				<html>
					<body>
						Post only
					</body>
				</html>`
		res.writeHead(200, { 'Content-Type': 'text/html' })
		res.end(html)
	}
}).listen(httpPort);
log(0, "HTTP Server started on " + httpPort);

noble.on('stateChange', async (state) => {
	if (state !== 'poweredOn') {
		log(1, "stateChange", state);
		noble.stopScanning();
		appState.scanning = false;
	}
});

process.on('SIGINT', async function () {
	log(0, "SIGINT, cleaning up");
	if (noble.state === "poweredOn") {
		await Object.keys(noble._bindings._handles).forEach(async k => {
			if (noble._peripherals[k]) {
				log(1, "Disconnecting ", noble._peripherals[k].id, noble._peripherals[k].advertisement.localName);
				await noble._peripherals[k].disconnectAsync();
			}
		});
	}
	process.exit();
});

noble.on('discover', async (peripheral) => {
	if ([peripheral.advertisement.localName, peripheral.id, peripheral.address].includes(appState.task.current.name)) {
		await noble.stopScanningAsync();
		appState.scanning = false;
		appState.task.current.state = "setup";
		appState.task.current.timestamp = Date.now();
		setupDevice(peripheral);
	}
});

const setupDevice = async (peripheral) => {
	log(1, `Peripheral with ID ${peripheral.id} found as ${peripheral.advertisement.localName}`, appState.task.current.alias, appState.task.current.state, appState.task.current.type, appState.task.queue.length);

	peripheral.on('disconnect', () => {
		log(1, peripheral.advertisement.localName, "disconnected", appState.task.current.alias, appState.task.current.state, appState.task.current.type);

		if (appState.task.current) {
			if (appState.task.current.state !== "complete") {
				log(2, "retry in 2", appState.task.current.state)
				appState.task.current.state = "reconnecting";
				appState.task.current.timestamp = Date.now();
				setTimeout(() => {
					startScan();
				}, 2000);
			} else {
				//don't add another check, push it out instead
				let checkq;
				if(checkq = appState.task.queue.find(q => (q.name===appState.task.current.name && q.type==="check") )) {
					checkq.waitTill = Date.now() + appState.checkInterval;
				} else if(appState.task.current.webhook && appState.checkInterval > 0) {
					let data = {
						alias: appState.task.current.alias,
						name: appState.task.current.name,
						webhook: appState.task.current.webhook,
						type: "check",
						waitTill: Date.now() + appState.checkInterval
					};
					appState.task.queue.push(data);	
				}
				appState.task.current = null;

				log(2, "Next task in 1")
				setTimeout(() => {
					nextTask();
				}, 1000);
			}
		}
	});

	try {
		peripheral.connectAsync()
			.then(() => peripheral.discoverServicesAsync(serviceUUIDs))
			.then((services) => services[0].discoverCharacteristicsAsync(characteristicUUIDs))
			.then(async (characteristics) => {
				characteristics[0].on('data', (data) => {
					log(3, "data", data, appState.task.current.alias, appState.task.current.state, appState.task.current.type);
					/* found via BLE snoop logs and test writes
					00 aa 00 00 is off, connected, or power just turned off
					00 aa aa 00 is off, passcode accepted
					00 aa 55 00 is off, passcode accepted
					01 xx aa 00 is on, passcode accepted
					01 xx 55 00 is on, passcode accepted
					01 xx 00 00 is on, xx represents power level
					00 92 00 00 is processing?
					1f 88 00 00 is done processing?
					*/
					if (data.compare(Buffer.from("00920000", "hex")) === 0) {
						log(3, "command processing");
					} else if (data.compare(Buffer.from("1f880000", "hex")) === 0) {
						log(3, "command set");
						appState.task.current.state = "complete";
						sendStatus(appState.task.current);
						setTimeout(() => {
							peripheral.disconnectAsync();
						}, 100);
					} else if (data.compare(Buffer.from("00aa0000", "hex")) === 0) {
						if (appState.task.current.state === "processing") {
							appState.task.current.state = "complete";
							sendStatus(appState.task.current);
							setTimeout(() => {
								peripheral.disconnectAsync();
							}, 100);
						} else {
							log(3, "connected, power is off");
							sendStatus({...appState.task.current, type:"off"});
							if(appState.task.current.type === "check") {
								appState.task.current.state = "complete";
								setTimeout(() => {
									peripheral.disconnectAsync();
								}, 100);
							}
						}
					} else if (data[0] === 0x01 && data[2] === 0x00) {
						log(3, "connected, power is on");
						sendStatus({...appState.task.current, type:"on"});
						if(appState.task.current.type === "check") {
							appState.task.current.state = "complete";
							setTimeout(() => {
								peripheral.disconnectAsync();
							}, 100);
						}
					} else if (data.compare(Buffer.from("00aaaa00", "hex")) === 0 || data.compare(Buffer.from("00aa5500", "hex")) === 0) {
						if (appState.task.current.type === "on") {
							log(3, "send toggle")
							appState.task.current.state = "processing";
							setTimeout(() => {
								characteristics[0].write(Buffer.from("1000", "hex")); //toggle power
							}, 100);
						} else if (appState.task.current.type === "off") {
							log(3, "already off")
							appState.task.current.state = "complete";
							sendStatus(appState.task.current);
							setTimeout(() => {
								peripheral.disconnectAsync();
							}, 100);
						}
					} else if (data[0] === 0x01 && (data[2] === 0xAA || data[2] === 0x55)) {
						if (appState.task.current.type === "off") {
							log(3, "send toggle")
							appState.task.current.state = "processing";
							setTimeout(() => {
								characteristics[0].write(Buffer.from("1000", "hex")); //toggle power
							}, 100);
						} else if (appState.task.current.type === "on") {
							log(3, "already on")
							appState.task.current.state = "complete";
							sendStatus(appState.task.current);
							setTimeout(() => {
								peripheral.disconnectAsync();
							}, 100);
						}
					} else {
						log(0, "unhandled data", data, appState.task.current.alias, appState.task.current.state);
					}
				});
				characteristics[0].subscribe(error => {
					if (error) {
						console.error('Error subscribing');
					} else {
						log(3, 'Subscribed for notifications');
						if(appState.task.current.pin) { //if we have a pin, queue it
							setTimeout(() => {
								appState.task.current.state = "connected";//we only need the connected state when we also have a pin
								characteristics[0].write(Buffer.from("4000", "hex")); //poke
								characteristics[0].write(Buffer.from("0"+ appState.task.current.pin.substr(0,1) + "00", "hex")); //passcode
								characteristics[0].write(Buffer.from("0"+ appState.task.current.pin.substr(1,1) + "00", "hex"));
								characteristics[0].write(Buffer.from("0"+ appState.task.current.pin.substr(2,1) + "00", "hex"));
								characteristics[0].write(Buffer.from("0"+ appState.task.current.pin.substr(4,1) + "00", "hex"));
								log(3, 'passcode sent');
							}, 100);
						}
					}
				});
			})
			.catch(ex => {
				console.error("Error", ex);		
			});
	} catch (ex) {
		console.error("Error", ex);
	}
	return;
};

function sendStatus(pkt) {
	if(pkt.webhook) {
		axios
		.post(pkt.webhook, pkt)
		.then((res) => {
			log(2, `sendStatus : ${res.statusText}`)
		})
		.catch((error) => {
			console.error("sendStatus", error)
		})
	}
}

function startScan() {
	//force noble to rest fully
	noble._peripherals = {};
	noble._services = {};
	noble._characteristics = {};
	noble._descriptors = {};
	noble._bindings._addresses = {};
	noble._bindings._addresseTypes = {};
	noble._bindings._connectable = {};
	noble.reset();
	appState.scanning = true;
	noble.startScanningAsync(serviceUUIDs, false);
}

function nextTask() {
	if(appState.task.current) {
		if(appState.task.current.timestamp && appState.task.current.timestamp+appState.timeout < Date.now()) {
			if(appState.scanning) {
				noble.stopScanning();
				appState.scanning = false;
			}
			appState.task.current.timestamp = 0;
			appState.task.current.state = "scanning";
			startScan();
		} //else just wait some more
	} else if(appState.task.queue.length > 0){
		let putback = [];
		let newTask;
		while(!newTask && appState.task.queue.length > 0){
			newTask = appState.task.queue.shift();
			if(newTask.waitTill) {
				if(newTask.waitTill > Date.now()) {
					putback.push({...{}, ...newTask}); //clone it back in 
					newTask = null;
				}
			}
		} 
		if(putback.length>0) {
			appState.task.queue.push(...putback);
		}
		if(newTask) {
			appState.task.current = newTask;
			appState.task.current.timestamp = 0;
			appState.task.current.state = "scanning";
			startScan();
		}
	}
}

function log(level, ...data) {
	if(level <= loglevel) console.log(...data); 
}

setInterval(() => {
	nextTask();
}, 5000); //checks for missed tasks just in case
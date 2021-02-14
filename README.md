<!-- PROJECT LOGO -->
<br />
<p align="center">
  <h2 align="center">Serta BLE Control</h2>

  <p align="center">
    Minimal API server to control Serta BLE enabled heated mattress pads
    <br />
    <a href="https://github.com/chrwei/serta-control/issues">Report Bug</a>
    ·
    <a href="https://github.com/chrwei/serta-control/issues">Request Feature</a>
  </p>
</p>



<!-- TABLE OF CONTENTS -->
<details open="open">
  <summary><h2 style="display: inline-block">Table of Contents</h2></summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li>
        <a href="#usage">Usage</a>
      <ul>
        <li><a href="#message-structure">Message Structure</a></li>
        <li><a href="#limitations-and-known-issues">Limitations and Known Issues</a></li>
      </ul>
    </li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgements">Acknowledgements</a></li>
  </ol>
</details>



<!-- ABOUT THE PROJECT -->
## About The Project
After using the completely awful Serta app with my new Serta Perfect Sleeper Bluetooth Wireless Heated Mattress Pad I decided something had to be done.  I was able to decipher enough of the BTLE protocol to turn it on and off using a script, and turned that into a basic HTTP API server to integrate with HomeAssistant, or whatever else I might use in the future, and this project is the result of that effort..


### Built With

* [nodejs](https://nodejs.org/)
* [@abandonware/noble](https://github.com/abandonware/noble#readme)


<!-- GETTING STARTED -->
## Getting Started

To get a local copy up and running follow these simple steps.

### Prerequisites

* Have your matress pad already setup with PIN in Serta HeatedPproduct Remote app.  This project does not implement the setup process and it is required.
* nodejs - Tested on v15.8.0 but older should work
* a BLE capable bluetooth device in your PC/server
* [noble's prerequisites](https://github.com/abandonware/noble#prerequisites)

### Installation

0. Follow [noble's prerequisites](https://github.com/abandonware/noble#prerequisites) for your operating system.  Don't skip the `setcap` step if you use GNU/Linux!  
1. Clone the repo
   ```sh
   git clone https://github.com/chrwei/serta-control.git
   ```
2. Change to the project folder
   ```sh
   cd serta-control
   ```
3. Install NPM packages
   ```sh
   npm install
   ```


<!-- USAGE EXAMPLES -->
## Usage

Run the server
```sh
node index.js
```
You should see output 
```
HTTP Server started on 8321
```

If you need to use a different port, edit index.js and find the httpPort variable.  You can also increase the level of output, which is handy for testing.
```javascript
//base configuration
const httpPort = 8321; //HTTP port to listen on
const loglevel = 1; //0:minimal, 1:add connection info, 2:add tasks, 3:add command processing 
```
For the first test, open http://localhost:8321/ (or whatever your server name or IP is), you should see "Post only" as only HTTP POST commands are implemented at this time.

Now use your favorite language or http testing tool to send commands to the server.

### Message Structure

The API only accepts a JSON POST body.  Make sure you set the `content-type` header to `application/json`.

The JSON needs to be an array even if you only have one controller.  You can send commands for as many controllers as you like.  Each command will use the structure:
```json
{
    "alias": "Left Side", 
    "name": "TM2-123456L", 
    "type": "on",
    "pin": "0000", 
    "webhook":"http://host/path" 
}
```
* `alias`: Friendly name of the controller.  This can be whatever you like.  I use it match up an entity in HomeAssistant.
* `name`: The controller's device name.  You can see this name in the list of devices when scanning bluetooth on your phone.  It will always start with TM2- and will end with L if the Serta app setup was completeled.
* `type`: Type of command.  Currently 3 types are supported: `on`, `off`, `check`.
* `pin`: the 4 digit pin you assigned in the app.  Pin is optional for the `check` type.
* `webhook`: Optional.  If provided, when a command completes it will POST the command to this URL.  If type is `check`, it will be replaced with `on` or `off` to reflect the state reported by the controller.

Once a command completes and if a webhook is provided, a timer will issue a `check` command once a minute to report any state changes. This interval can be configured using the `checkInterval` variable in the code. 

Example for 2 controllers, turn on:
```json
  [
    {"alias": "left", "name": "TM2-123456L", "pin":"0000", "type": "on" ,"webhook":"http://homeassistant.local:8123/api/webhook/sertastate" },
    {"alias": "right", "name": "TM2-654321L", "pin":"1111", "type": "on", "webhook":"http://homeassistant.local:8123/api/webhook/sertastate" }
  ]
```

Example for 1 controller, turn off, no webhook:
```json
  [
    {"alias": "bed", "name": "TM2-123456L", "pin":"0000", "type": "off" }
  ]
```

### Limitations and Known Issues

* Only the On and Off status are implemented.
* Only one controller can be communicated with at once, so commands are done sequentially.
* Commands are done in the order the bluetooth scan finds them, not the order you submit. 
* Controllers seem to disconnect at random.  Retries should happen automatically, and indefinatly.
* Retry will not skip a controller, it will keep retying until it works, leaving the other in the queue.  I have yet to see it take more than 3 tries.

<!-- CONTRIBUTING -->
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

While any contribution is welcome, including improvements to this readme, here is a list of things I'd like to see added but are not a high priority for me right now.

* A Smartphone friendly web page to issue commands
* Setup routine
* Temperature reporting and changing
* Built in scheduling

<!-- LICENSE -->
## License

Distributed under the GPLv3 License. See the `LICENSE` file for more information.

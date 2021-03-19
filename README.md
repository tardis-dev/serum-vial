<img src="https://raw.githubusercontent.com/tardis-dev/serum-vial/master/logo.svg">

# serum-vial

[![Version](https://img.shields.io/npm/v/serum-vial.svg)](https://www.npmjs.org/package/serum-vial)

Real-time market data API server for Serum DEX
<br/>

## Architecture

![architecture diagram](https://user-images.githubusercontent.com/51779538/92960443-ed6a4a00-f46d-11ea-9da8-2d4546db8a7d.png)

- server runs with multiple `Minions` worker threads\* and single `Serum Producer` that runs in the main thread
- `Minions` are responsible for WebSockets subscriptions management, constructing L2 & L1 messages out of L3 messages published by `Serum Producer` and broadcasting all those messages to all subscribed clients
- `Serum Producer` is responsible for connecting to Serum Node RPC WS API and subscribing all relevant accounts changes (event & request queue, bids & asks) for all supported markets as well as producing L3 market data messages that are then passed to minions and published as WebSocket messages to all subscribed clients

\* multi core support via [`worker_threads`](https://nodejs.org/api/worker_threads.html) is linux only feature which allows multiple threads to bind to the same port, see https://github.com/uNetworking/uWebSockets.js/issues/304 and https://lwn.net/Articles/542629/ - for other OSes there's only one worker thread running
<br/>
<br/>

## Installation options

- ### npx <sub>(requires Node.js >= 12 installed on host machine)</sub>

  That will start serum-vial server running on port `8000`

  ```sh
  npx serum-machine
  ```

  If you'd like to switch to different Serum Node endpoint, change port or run with debug logs enabled, just add one of the available CLI options:

  ```sh
  npx serum-machine --endpoint https://solana-api.projectserum.com --debug --port 8080
  ```

  Run `npx serum-machine --help` to see all available startup options (node endpoint url, port etc.)
  <br/>
  <br/>

- ### npm <sub>(requires Node.js >= 12 installed on host machine)</sub>

  Installs `serum-machine` globally and runs it on port `8000`.

  ```sh
  npm install -g serum-machine
  serum-machine
  ```

  If you'd like to switch to different Serum Node endpoint, change port or run with debug logs enabled, just add one of the available CLI options:

  ```sh
  serum-machine --endpoint https://solana-api.projectserum.com --debug --port 8080
  ```

  Run `serum-machine --help` to see all available startup options (node endpoint url, port etc.)
  <br/>
  <br/>

- ### Docker
  Pulls and runs latest version of [`tardisdev/serum-machine` image](https://hub.docker.com/r/tardisdev/serum-machine). Serum Matchine server will available on host via `8000` port (for example [http://localhost:8000/v1/markets](http://localhost:8000/v1/markets)) with debug logs enabled (`TM_DEBUG` env var).
  ```sh
  docker run -p 8000:8000 -e "SM_ENDPOINT=https://solana-api.projectserum.com" -e "SM_DEBUG=true" -d tardisdev/serum-machine:latest
  ```
  <br/>
  <br/>

## WebSocket `/ws` endpoint

Allows subscribing to Serum DEX real-market data streams.

```js
const ws = new WebSocket('ws://localhost:8000/v1/streams')

ws.onmessage = (message) => {
  console.log(message)
}

ws.onopen = () => {
  const subscribePayload = {
    op: 'subscribe',
    channel: 'level3',
    markets: ['BTC/USDT']
  }

  ws.send(JSON.stringify(subscribePayload))
}
```

<br/>
<br/>

## HTTP endpoints

### `/markets`

Accepts no params and returns non depreciated Serum markets.

#### Sample request & response

[http://localhost:8000/v1/markets](http://localhost:8000/v1/markets)

```json
[
 {
    "symbol": "BTC/USDT",
    "deprecated": false,
    "address": "EXnGBBSamqzd3uxEdRLUiYzjJkTwQyorAaFXdfteuGXe",
    "programId": "EUqojwWA2rd19FZrzeBncJsm38Jm1hEhE3zsmX3bRc2o",
    "tickSize": 0.1,
    "minOrderSize": 0.0001,
    "supportsReferralFees": true,
    "supportsSrmFeeDiscounts": true
  },
  {
    "symbol": "BTC/USDC",
    "deprecated": false,
    "address": "5LgJphS6D5zXwUVPU7eCryDBkyta3AidrJ5vjNU6BcGW",
    "programId": "EUqojwWA2rd19FZrzeBncJsm38Jm1hEhE3zsmX3bRc2o",
    "tickSize": 0.1,
    "minOrderSize": 0.0001,
    "supportsReferralFees": true,
    "supportsSrmFeeDiscounts": true
  }
  ...
]
```

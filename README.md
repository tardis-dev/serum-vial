<img src="https://raw.githubusercontent.com/tardis-dev/serum-vial/master/logo.svg">

# serum-vial: real-time WebSocket market data API for Serum

[![Version](https://img.shields.io/npm/v/serum-vial.svg)](https://www.npmjs.org/package/serum-vial)
[![Docker version](https://img.shields.io/docker/v/tardisdev/serum-vial/latest?label=Docker)](https://hub.docker.com/r/tardisdev/serum-vial)

<br/>

## Why?

We all know that Serum DEX is awesome, but since it's a new ecosystem, some tooling around it may not be so convenient and productive especially from centralized exchanges APIs users perspective. Serum-vial which is a real-time WebSocket market data API server for Serum DEX hopes to alleviate some of those issues by offering:

- **familiar experience for centralized exchanges APIs users**

  - **WebSocket API with Pub/Sub flow** - subscribe to selected channels and markets and receive real-time data as easy to parse JSON messages that can be consumed from any language supporting WebSocket protocol

  - **incremental L2 order book updates** - instead of decoding Serum market `asks` and `bids` accounts for each account change in order to detect order book changes, receive initial L2 snapshot and incremental updates as JSON messages real-time

  - **tick-by-tick trades** - instead of decoding `eventQueue` account data which can be large (>1MB) and in practice it's hard to consume real-time directly from Solana RPC node due to it's size, receive individual trade messages real-time

  - **real-time L3 data** - receive updates on individual order level: opens, changes, fills and cancellations for each order Serum DEX handles

- **decreased load and bandwidth consumption for solana RPC nodes hosts** - by providing real-time market data API via serum-vial server instead of RPC node, hosts can decrease substantially both CPU load and bandwidth requirements as only serum-vial will be direct consumer of RPC API when it comes to market data accounts changes and will efficiently normalize and broadcast small JSON messages to all connected clients

<br/>

## Installation

- ### npx <sub>(requires Node.js >= 15 installed on host machine)</sub>

  That will start serum-vial server running on port `8000`

  ```sh
  npx serum-vial
  ```

  If you'd like to switch to different Serum Node endpoint, change port or run with debug logs enabled, just add one of the available CLI options:

  ```sh
  npx serum-vial --endpoint https://solana-api.projectserum.com --log-level debug --port 8080
  ```

  Run `npx serum-vial --help` to see all available startup options (node endpoint url, port etc.)
  <br/>
  <br/>

- ### npm <sub>(requires Node.js >= 12 installed on host machine)</sub>

  Installs `serum-vial` globally and runs it on port `8000`.

  ```sh
  npm install -g serum-vial
  serum-vial
  ```

  If you'd like to switch to different Serum Node endpoint, change port or run with debug logs enabled, just add one of the available CLI options:

  ```sh
  serum-vial --endpoint https://solana-api.projectserum.com --debug --port 8080
  ```

  Run `serum-vial --help` to see all available startup options (node endpoint url, port etc.)
  <br/>
  <br/>

- ### Docker
  Pulls and runs latest version of [`tardisdev/serum-vial` image](https://hub.docker.com/r/tardisdev/serum-vial). Serum Matchine server will available on host via `8000` port (for example [http://localhost:8000/v1/markets](http://localhost:8000/v1/markets)) with debug logs enabled (`SV_LOG_LEVEL` env var).
  ```sh
  docker run -p 8000:8000 -e "SM_ENDPOINT=https://solana-api.projectserum.com" -e "SV_LOG_LEVEL=debug" -d tardisdev/serum-vial:latest
  ```
  <br/>
  <br/>

## Architecture

![architecture diagram](https://user-images.githubusercontent.com/51779538/111766810-3f20e080-88a6-11eb-8c4c-54787332cc84.png)

- server runs with multiple\* `Minions` worker threads and multiple `Serum Producers`
- `Minions` are responsible for WebSockets subscriptions management, constructing L2 & L1 messages out of L3 messages published by `Serum Producer` and broadcasting all those messages to all subscribed clients
- `Serum Producer` is responsible for connecting to Serum Node RPC WS API and subscribing all relevant accounts changes (event & request queue, bids & asks) for all supported markets as well as producing L3 market data messages that are then passed to minions and published as WebSocket messages to all subscribed clients
- by default all non depreciated markets, can be changed by providing market.json

\* multi core support via [`worker_threads`](https://nodejs.org/api/worker_threads.html) for `Minions` is linux only feature which allows multiple threads to bind to the same port, see https://github.com/uNetworking/uWebSockets.js/issues/304 and https://lwn.net/Articles/542629/ - for other OSes there's only one worker thread running
<br/>
<br/>

## WebSocket `/ws` endpoint

Allows subscribing to Serum DEX real-market data streams.

```js
const ws = new WebSocket('ws://localhost:8000/v1/ws')

ws.onmessage = (message) => {
  console.log(message)
}

ws.onopen = () => {
  const subscribePayload = {
    op: 'subscribe',
    channel: 'level2', // or level1, level3, trades
    markets: ['BTC/USDC']
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

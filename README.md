<img src="https://raw.githubusercontent.com/tardis-dev/serum-vial/master/logo.svg">

# serum-vial: real-time WS market data API for Serum

[![Version](https://img.shields.io/npm/v/serum-vial.svg?color=05aac5)](https://www.npmjs.org/package/serum-vial)
[![Docker version](https://img.shields.io/docker/v/tardisdev/serum-vial/latest?label=Docker&color=05aac5)](https://hub.docker.com/r/tardisdev/serum-vial)

<br/>

## Why?

We all know that Serum DEX is awesome, but since it's a new ecosystem, some tooling around it may not be so convenient and productive especially from centralized exchanges APIs users perspective. Serum-vial which is a real-time WebSocket market data API server for Serum DEX hopes to alleviate some of those issues by offering:

- **familiar experience for centralized exchanges APIs users**

  - **WebSocket API with Pub/Sub flow** - subscribe to selected channels and markets and receive real-time data as easy to parse JSON messages that can be consumed from any language supporting WebSocket protocol

  - **incremental L2 order book updates** - instead of decoding Serum market `asks` and `bids` accounts for each account change in order to detect order book changes, receive initial L2 snapshot and incremental updates as JSON messages real-time over WebSocket connection

  - **tick-by-tick trades** - instead of decoding `eventQueue` account data which can be large (>1MB) and in practice it's hard to consume real-time directly from Solana RPC node due to it's size, receive individual trade messages real-time over WebSocket connection

  - **real-time L3 data** - receive the most granular updates on individual order level, opens, changes, fills and cancellations for each order Serum DEX handles

- **decreased load and bandwidth consumption for Solana RPC nodes hosts** - by providing real-time market data API via serum-vial server instead of RPC node directly, hosts can decrease substantially both CPU load and bandwidth requirements as only serum-vial will be direct consumer of RPC API when it comes to market data accounts changes and will efficiently normalize and broadcast small JSON messages to all connected clients

<br/>

## What about placing/cancelling orders endpoints?

Serum-vial provides real-time market data only and does not include endpoints for placing/canceling or tracking own orders as that requires handling private keys which is currently out of scope of this project.
Please see [serum-rest-server](https://github.com/project-serum/serum-rest-server) or [@project-serum/serum](https://github.com/project-serum/serum-ts/tree/master/packages/serum) as a good alternatives.

<br/>

## Getting started

Run the code snippet below in the browser Dev Tools directly or in Node.js (requires installation of `ws` lib, [see](https://runkit.com/thad/serum-vial-node-js-sample)).

```js
// connect to hosted demo server
const ws = new WebSocket('wss://serum-vial.tardis.dev/v1/ws')
// if connecting to serum-vial server running locally
// const ws = new WebSocket('ws://localhost:8000/v1/ws')

ws.onmessage = (message) => {
  console.log(JSON.parse(message.data))
}

ws.onopen = () => {
  // subscribe both to L2 and L3 real-time channels
  const subscribeL2 = {
    op: 'subscribe',
    channel: 'level2',
    markets: ['BTC/USDC']
  }

  const subscribeL3 = {
    op: 'subscribe',
    channel: 'level3',
    markets: ['BTC/USDC']
  }

  ws.send(JSON.stringify(subscribeL2))
  ws.send(JSON.stringify(subscribeL3))
}
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=05aac5)](https://runkit.com/thad/serum-vial-node-js-sample)

<br/>

## Demo

Demo of Serum DEX UI backed by serum-vial WebSocket API for trade and order book data is available at:

[serum-dex.tardis.dev](https://serum-dex.tardis.dev/)

Since by default serum-vial uses [`confirmed` commitment level](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment) for getting accounts notification from RPC node, it may sometimes feel slightly lagging when it comes to order book updates vs default DEX UI which uses [`recent/processed` commitment](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment). Trade data is provided faster since by default DEX UI is pooling `eventQueue` account data on interval due to it's size (> 1MB), and serum-vial uses real-time `eventQueue` account notification as a source for trade messages which aren't delayed by pooling interval time.

[![See demo](https://img.shields.io/badge/-See%20Demo-c?color=05aac5)](https://serum-dex.tardis.dev/)

<br/>

## Installation

## npx <sub>(requires Node.js >= 15 and git installed on host machine)</sub>

Installs and starts serum-vial server running on port `8000`.

```sh
npx serum-vial
```

If you'd like to switch to different Solana RPC node endpoint, change port or run with debug logs enabled, just add one of the available CLI options.

```sh
npx serum-vial --endpoint https://solana-api.projectserum.com --log-level debug --port 8080
```

#### CLI options

| &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | default                                                                                                                                                             | description                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `port`                                                                                                                                                                                   | 8000                                                                                                                                                                | Port to bind server on                                                                                         |
| `endpoint`                                                                                                                                                                               | https://solana-api.projectserum.com                                                                                                                                 | Solana RPC node endpoint that serum-vial uses as a data source                                                 |
| `log-level`                                                                                                                                                                              | info                                                                                                                                                                | Log level, available options: debug, info, warn and error                                                      |
| `minions-count`                                                                                                                                                                          | 1                                                                                                                                                                   | Minions worker threads count that are responsible for broadcasting normalized WS messages to connected clients |
| `commitment`                                                                                                                                                                             | confirmed                                                                                                                                                           | Solana commitment level to use when communicating with RPC node, available options: confirmed and processed    |
| `markets-json`                                                                                                                                                                           | `@project-serum/serum` [markets.json](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) file, but only non depreciated markets | path to custom market.json definition file if one wants to run serum-vial for custom markets                   |

<br/>
Run `npx serum-vial --help` to see all available startup options.
<br/>
<br/>

## npm <sub>(requires Node.js >= 15 and git installed on host machine)</sub>

Installs `serum-vial` globally and runs it on port `8000`.

```sh
npm install -g serum-vial
serum-vial
```

If you'd like to switch to different Solana RPC node endpoint, change port or run with debug logs enabled, just add one of the available CLI options.

```sh
serum-vial --endpoint https://solana-api.projectserum.com --log-level debug --port 8080
```

#### CLI options

| &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | default                                                                                                                                                             | description                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `port`                                                                                                                                                                                   | 8000                                                                                                                                                                | Port to bind server on                                                                                         |
| `endpoint`                                                                                                                                                                               | https://solana-api.projectserum.com                                                                                                                                 | Solana RPC node endpoint that serum-vial uses as a data source                                                 |
| `log-level`                                                                                                                                                                              | info                                                                                                                                                                | Log level, available options: debug, info, warn and error                                                      |
| `minions-count`                                                                                                                                                                          | 1                                                                                                                                                                   | Minions worker threads count that are responsible for broadcasting normalized WS messages to connected clients |
| `commitment`                                                                                                                                                                             | confirmed                                                                                                                                                           | Solana commitment level to use when communicating with RPC node, available options: confirmed and processed    |
| `markets-json`                                                                                                                                                                           | `@project-serum/serum` [markets.json](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) file, but only non depreciated markets | path to custom market.json definition file if one wants to run serum-vial for custom markets                   |

<br/>
  Run `serum-vial --help` to see all available startup options.
  <br/>
  <br/>

## Docker

Pulls and runs latest version of [`tardisdev/serum-vial` Docker Image](https://hub.docker.com/r/tardisdev/serum-vial) on port `8000`.

```sh
docker run -p 8000:8000 -d tardisdev/serum-vial:latest
```

If you'd like to switch to different Solana RPC node endpoint, change port or run with debug logs enabled, just specify those via one of the available env variables.

```sh
docker run -p 8000:8000 -e "SV_ENDPOINT=https://solana-api.projectserum.com" -e "SV_LOG_LEVEL=debug" -d tardisdev/serum-vial:latest
```

#### ENV Variables

| &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | default                                                                                                                                                             | description                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SV_PORT`                                                                                                                                                                                | 8000                                                                                                                                                                | Port to bind server on                                                                                         |
| `SV_ENDPOINT`                                                                                                                                                                            | https://solana-api.projectserum.com                                                                                                                                 | Solana RPC node endpoint that serum-vial uses as a data source                                                 |
| `SV_LOG_LEVEL`                                                                                                                                                                           | info                                                                                                                                                                | Log level, available options: debug, info, warn and error                                                      |
| `SV_MINIONS_COUNT`                                                                                                                                                                       | 1                                                                                                                                                                   | Minions worker threads count that are responsible for broadcasting normalized WS messages to connected clients |
| `SV_COMMITMENT`                                                                                                                                                                          | confirmed                                                                                                                                                           | Solana commitment level to use when communicating with RPC node, available options: confirmed and processed    |
| `SV_MARKETS_JSON`                                                                                                                                                                        | `@project-serum/serum` [markets.json](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) file, but only non depreciated markets | path to custom market.json definition file if one wants to run serum-vial for custom markets                   |

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

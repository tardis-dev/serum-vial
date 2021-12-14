<img src="https://raw.githubusercontent.com/tardis-dev/serum-vial/master/logo.svg">

[![Version](https://img.shields.io/npm/v/serum-vial.svg?color=05aac5)](https://www.npmjs.org/package/serum-vial)
[![Docker version](https://img.shields.io/docker/v/tardisdev/serum-vial/latest?label=Docker&color=05aac5)](https://hub.docker.com/r/tardisdev/serum-vial)

# serum-vial: real-time WS market data API for Serum DEX

<br/>

## Why?

We all know that Serum DEX is awesome, but since it's a new ecosystem, tooling around it may not be so convenient especially from centralized exchanges APIs users perspective. Serum-vial which is a real-time WebSocket market data API server for Serum DEX hopes to alleviate some of those issues by offering:

- **familiar experience for centralized exchanges APIs users**

  - **WebSocket API with Pub/Sub flow** - subscribe to selected channels and markets and receive real-time data as easy to parse JSON messages that can be consumed from any language supporting WebSocket protocol

  - **incremental L2 order book updates** - instead of decoding Serum market `asks` and `bids` accounts for each account change in order to detect order book updates, receive [initial L2 snapshot](#l2snapshot) and [incremental updates](#l2update) as JSON messages real-time over WebSocket connection

  - **tick-by-tick trades** - instead of decoding `eventQueue` account data which is quite large (> 1MB) and in practice it's hard to consume real-time directly from Solana RPC node due to it's size, receive individual [`trade`](#trade) messages real-time over WebSocket connection

  - **real-time L3 data** - receive the most granular updates on individual order level: [`open`](#open), [`change`](#change), [`fill`](#fill) and [`done`](#done) messages for every order that Serum DEX processes

- **decreased load and bandwidth consumption for Solana RPC nodes hosts** - by providing real-time market data API via serum-vial server instead of RPC node directly, hosts can decrease substantially both CPU load and bandwidth requirements as only serum-vial will be direct consumer of RPC API when it comes to market data accounts changes and will efficiently normalize and broadcast small JSON messages to all connected clients

## What about placing/cancelling orders endpoints?

Serum-vial provides real-time market data only and does not include endpoints for placing/canceling or tracking own orders as that requires handling private keys which is currently out of scope of this project.

Both [serum-rest-server](https://github.com/project-serum/serum-rest-server) and [@project-serum/serum](https://github.com/project-serum/serum-ts/tree/master/packages/serum) provide such functionality and are recommended alternatives.

<br/>
<br/>

## Getting started

Run the code snippet below in the browser Dev Tools directly or in Node.js (requires installation of `ws` lib, [see](https://runkit.com/thad/serum-vial-node-js-sample)).

```js
// connect to hosted server
const ws = new WebSocket('wss://api.serum-vial.dev/v1/ws')
// if connecting to serum-vial server running locally
// const ws = new WebSocket('ws://localhost:8000/v1/ws')

ws.onmessage = (message) => {
  console.log(JSON.parse(message.data))
}

ws.onopen = () => {
  // subscribe both to trades and level2 real-time channels
  const subscribeTrades = {
    op: 'subscribe',
    channel: 'trades',
    markets: ['BTC/USDC']
  }

  const subscribeL2 = {
    op: 'subscribe',
    channel: 'level2',
    markets: ['BTC/USDC']
  }

  ws.send(JSON.stringify(subscribeTrades))
  ws.send(JSON.stringify(subscribeL2))
}
```

[![Try this code live on RunKit](https://img.shields.io/badge/-Try%20this%20code%20live%20on%20RunKit-c?color=05aac5)](https://runkit.com/thad/serum-vial-node-js-sample)

<br/>
<br/>

## Using public hosted server

Serum-vial public hosted WebSocket server (backed by Project Serum RPC node) is available at:

<br/>

[wss://api.serum-vial.dev/v1/ws](wss://api.serum-vial.dev/v1/ws)

<br/>

This public server is maintained on best effort basis.

<br/>

Serum DEX UI backed by this public server (for it's trade and order book data feeds) is available at:

<br/>

[https://serum-vial.dev](https://serum-vial.dev/)

<br/>

Since by default serum-vial uses [`confirmed` commitment level](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment) for getting accounts notification from RPC node, it may sometimes feel slightly slower when it comes to order book updates vs default DEX UI which uses [`recent/processed` commitment](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment), but data is more accurate on the other hand.

Trade data is published faster since by default DEX UI is pooling `eventQueue` account data on interval due to it's size (> 1MB), and serum-vial uses real-time `eventQueue` account notification as a source for trade messages which aren't delayed by pooling interval time.

[![See serum-vial backed DEX](https://img.shields.io/badge/-See%20Demo%20DEX%20UI-c?color=05aac5)](https://serum-vial.dev/)

<br/>
<br/>

## Installation

---

# IMPORTANT NOTE

For the best serum-vial data reliability it's advised to [set up a dedicated Solana RPC node](https://docs.solana.com/running-validator) and connect `serum-vial` to it instead of default `https://solana-api.projectserum.com` which may rate limit or frequently restart Websocket RPC connections since it's a public node used by many.

---

<br/>
<br/>

### npx <sub>(requires Node.js >= 15 and git installed on host machine)</sub>

Installs and starts serum-vial server running on port `8000`.

```sh
npx serum-vial
```

If you'd like to switch to different Solana RPC node endpoint like for example local one, change port or run with debug logs enabled, just add one of the available CLI options.

```sh
npx serum-vial --endpoint http://localhost:8090 --ws-endpoint-port 8899 --log-level debug --port 8900
```

Alternatively you can install serum-vial globally.

```sh
npm install -g serum-vial
serum-vial
```

<br/>

#### CLI options

| &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | default                                                                                                                                                             | description                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`                                                                                                                                                                                                                                                                                                  | 8000                                                                                                                                                                | Port to bind server on                                                                                                                                                                             |
| `endpoint`                                                                                                                                                                                                                                                                                              | https://solana-api.projectserum.com                                                                                                                                 | Solana RPC node endpoint that serum-vial uses as a data source                                                                                                                                     |
| `ws-endpoint-port`                                                                                                                                                                                                                                                                                      | -                                                                                                                                                                   | Optional Solana RPC WS node endpoint port that serum-vial uses as a data source (if different than REST endpoint port) source                                                                      |
| `log-level`                                                                                                                                                                                                                                                                                             | info                                                                                                                                                                | Log level, available options: debug, info, warn and error                                                                                                                                          |
| `minions-count`                                                                                                                                                                                                                                                                                         | 1                                                                                                                                                                   | [Minions worker threads](#architecture) count that are responsible for broadcasting normalized WS messages to connected clients                                                                    |
| `commitment`                                                                                                                                                                                                                                                                                            | confirmed                                                                                                                                                           | [Solana commitment level](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment) to use when communicating with RPC node, available options: confirmed and processed |
| `markets-json`                                                                                                                                                                                                                                                                                          | `@project-serum/serum` [markets.json](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) file, but only non depreciated markets | path to custom market.json definition file if one wants to run serum-vial for custom markets                                                                                                       |

<br/>

Run `npx serum-vial --help` to see all available startup options.

<br/>
<br/>

### Docker

Pulls and runs latest version of [`tardisdev/serum-vial` Docker Image](https://hub.docker.com/r/tardisdev/serum-vial) on port `8000`.

```sh
docker run -p 8000:8000 -d tardisdev/serum-vial:latest
```

If you'd like to switch to different Solana RPC node endpoint, change port or run with debug logs enabled, just specify those via one of the available env variables.

```sh
docker run -p 8000:8000 -e "SV_LOG_LEVEL=debug" -d tardisdev/serum-vial:latest
```

<br/>

#### ENV Variables

| &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | default                                                                                                                                                             | description                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SV_PORT`                                                                                                                                                                                                                                                                                               | 8000                                                                                                                                                                | Port to bind server on                                                                                                                                                                             |
| `SV_ENDPOINT`                                                                                                                                                                                                                                                                                           | https://solana-api.projectserum.com                                                                                                                                 | Solana RPC node endpoint that serum-vial uses as a data source                                                                                                                                     |
| `SV_WS_ENDPOINT_PORT`                                                                                                                                                                                                                                                                                   | -                                                                                                                                                                   | Optional Solana RPC WS node endpoint port that serum-vial uses as a data source (if different than REST endpoint port) source                                                                      |
| `SV_LOG_LEVEL`                                                                                                                                                                                                                                                                                          | info                                                                                                                                                                | Log level, available options: debug, info, warn and error                                                                                                                                          |
| `SV_MINIONS_COUNT`                                                                                                                                                                                                                                                                                      | 1                                                                                                                                                                   | [Minions worker threads](#architecture) count that are responsible for broadcasting normalized WS messages to connected clients                                                                    |
| `SV_COMMITMENT`                                                                                                                                                                                                                                                                                         | confirmed                                                                                                                                                           | [Solana commitment level](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment) to use when communicating with RPC node, available options: confirmed and processed |
| `SV_MARKETS_JSON`                                                                                                                                                                                                                                                                                       | `@project-serum/serum` [markets.json](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) file, but only non depreciated markets | path to custom market.json definition file if one wants to run serum-vial for custom markets                                                                                                       |

<br/>
<br/>

### SSL/TLS Support

Serum-vial supports [SSL/TLS](https://en.wikipedia.org/wiki/Transport_Layer_Security) but it's not enabled by default. In order to enable it you need to set `CERT_FILE_NAME` env var pointing to the certificate file and `KEY_FILE_NAME` pointing to private key of that certificate.

<br/>
<br/>

## WebSocket API

WebSocket API provides real-time market data feeds of Serum DEX and uses a bidirectional protocol which encodes all messages as JSON objects.

<br/>

### Endpoint URL

- **[ws://localhost:8010/v1/ws](ws://localhost:8000/v1/ws)** - assuming serum-vial runs locally on default port without SSL enabled

- **[wss://api.mango-bowl.com/v1/ws](wss://api.mango-bowl.com/v1/ws)** - hosted serum-vial server endpoint

<br/>

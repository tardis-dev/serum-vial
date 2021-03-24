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
<br/>

## What about placing/cancelling orders endpoints?

Serum-vial provides real-time market data only and does not include endpoints for placing/canceling or tracking own orders as that requires handling private keys which is currently out of scope of this project.

Both [serum-rest-server](https://github.com/project-serum/serum-rest-server) and [@project-serum/serum](https://github.com/project-serum/serum-ts/tree/master/packages/serum) provide such functionality and are recommended alternatives.

<br/>
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
<br/>

## Demo

Demo of Serum DEX UI backed by serum-vial WebSocket API for trade and order book data is available at:

[serum-dex.tardis.dev](https://serum-dex.tardis.dev/)

Since by default serum-vial uses [`confirmed` commitment level](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment) for getting accounts notification from RPC node, it may sometimes feel slightly lagging when it comes to order book updates vs default DEX UI which uses [`recent/processed` commitment](https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment). Trade data is provided faster since by default DEX UI is pooling `eventQueue` account data on interval due to it's size (> 1MB), and serum-vial uses real-time `eventQueue` account notification as a source for trade messages which aren't delayed by pooling interval time.

[![See demo](https://img.shields.io/badge/-See%20Demo-c?color=05aac5)](https://serum-dex.tardis.dev/)

<br/>
<br/>

## Installation

### npx <sub>(requires Node.js >= 15 and git installed on host machine)</sub>

Installs and starts serum-vial server running on port `8000`.

```sh
npx serum-vial
```

If you'd like to switch to different Solana RPC node endpoint, change port or run with debug logs enabled, just add one of the available CLI options.

```sh
npx serum-vial --endpoint https://solana-api.projectserum.com --log-level debug --port 8080
```

Alternatively you can install serum-vial globally.

```sh
npm install -g serum-vial
serum-vial
```

<br/>

#### CLI options

| &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | default                                                                                                                                                             | description                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `port`                                                                                                                                                                                                 | 8000                                                                                                                                                                | Port to bind server on                                                                                         |
| `endpoint`                                                                                                                                                                                             | https://solana-api.projectserum.com                                                                                                                                 | Solana RPC node endpoint that serum-vial uses as a data source                                                 |
| `log-level`                                                                                                                                                                                            | info                                                                                                                                                                | Log level, available options: debug, info, warn and error                                                      |
| `minions-count`                                                                                                                                                                                        | 1                                                                                                                                                                   | Minions worker threads count that are responsible for broadcasting normalized WS messages to connected clients |
| `commitment`                                                                                                                                                                                           | confirmed                                                                                                                                                           | Solana commitment level to use when communicating with RPC node, available options: confirmed and processed    |
| `markets-json`                                                                                                                                                                                         | `@project-serum/serum` [markets.json](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) file, but only non depreciated markets | path to custom market.json definition file if one wants to run serum-vial for custom markets                   |

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

| &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; | default                                                                                                                                                             | description                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SV_PORT`                                                                                                                                                                                              | 8000                                                                                                                                                                | Port to bind server on                                                                                         |
| `SV_ENDPOINT`                                                                                                                                                                                          | https://solana-api.projectserum.com                                                                                                                                 | Solana RPC node endpoint that serum-vial uses as a data source                                                 |
| `SV_LOG_LEVEL`                                                                                                                                                                                         | info                                                                                                                                                                | Log level, available options: debug, info, warn and error                                                      |
| `SV_MINIONS_COUNT`                                                                                                                                                                                     | 1                                                                                                                                                                   | Minions worker threads count that are responsible for broadcasting normalized WS messages to connected clients |
| `SV_COMMITMENT`                                                                                                                                                                                        | confirmed                                                                                                                                                           | Solana commitment level to use when communicating with RPC node, available options: confirmed and processed    |
| `SV_MARKETS_JSON`                                                                                                                                                                                      | `@project-serum/serum` [markets.json](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) file, but only non depreciated markets | path to custom market.json definition file if one wants to run serum-vial for custom markets                   |

<br/>
<br/>

### SSL/TLS Support

Serum-vial supports [SSL/TLS](https://en.wikipedia.org/wiki/Transport_Layer_Security) but it's not enabled by default. In order to enable it you need to set `CERT_FILE_NAME` env var pointing to the certificate file and `KEY_FILE_NAME` pointing to private key of that certificate.

<br/>
<br/>

## WebSocket API

WebSocket API provides real-time market data feeds of Serum DEX and uses a bidirectional protocol which encodes all messages as JSON objects.

Each WebSocket client is required to actively send native WebSocket [pings](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#pings_and_pongs_the_heartbeat_of_websockets) to the server with interval less than 30 seconds, otherwise connection may be dropped due to inactivity.

<br/>

### Endpoint URL

#### `ws://localhost:8000/v1/ws`

(assuming serum-vial runs locally on default port without SSL enabled)

<br/>

### Subscribing to data feeds

To begin receiving real-time market data feed messages, you must first send a subscribe message to the server indicating which channels and markets to receive.

If you want to unsubscribe from channel and markets, send an unsubscribe message. The structure is equivalent to subscribe messages except `op` field which should be set to `"op": "unsubscribe"`.

```js
const ws = new WebSocket('ws://localhost:8000/v1/ws')

ws.onopen = () => {
  const subscribeL2 = {
    op: 'subscribe',
    channel: 'level2',
    markets: ['BTC/USDC']
  }

  ws.send(JSON.stringify(subscribeL2))
}
```

<br/>

#### Subscribe/unsubscribe message format

```ts
{
  "op": "subscribe" | "unsubscribe",
  "channel": "level3" | "level2" | "level1" | "trades",
  "markets": string[]
}
```

##### Sample `subscribe` message

```json
{
  "op": "subscribe",
  "channel": "level2",
  "markets": ["BTC/USDC"]
}
```

<br/>

#### Subscription confirmation message format

Once a subscribe (or unsubscribe) message is received by the server, it will respond with a `subscribed` (or `unsubscribed`) confirmation message or `error` if received message was invalid.

```ts
{
"type": "subscribed" | "unsubscribed",
"channel": "level3" | "level2" | "level1" | "trades",
"markets": string[],
"timestamp": string
}
```

##### Sample `subscribed` confirmation message

```json
{
  "type": "subscribed",
  "channel": "level2",
  "markets": ["BTC/USDC"],
  "timestamp": "2021-03-23T17:06:30.010Z"
}
```

<br/>

#### Error message format

Error message is returned for invalid subscribe/unsubscribe messages - no existing market, invalid channel name etc.

```ts
{
  "type": "error",
  "message": "string,
  "timestamp": "string
}
```

##### Sample `error` message

```json
{
  "type": "error",
  "message": "Invalid channel provided: 'levels1'.",
  "timestamp": "2021-03-23T17:13:31.010Z"
}
```

<br/>
<br/>

### Available channels & corresponding message types

- `trades`

  - `recent_trades`
  - `trade`

- `level1`

  - `recent_trades`
  - `trade`
  - `quote`

- `level2`

  - `l2snapshot`
  - `l2update`
  - `recent_trades`
  - `trade`

- `level3`

  - `l3snapshot`
  - `open`
  - `fill`
  - `change`
  - `done`

<br/>
<br/>

### Available markets

<br/>
<br/>

### Data messages

- `type` is determining message's data type so it can be handled appropriately
- `timestamp` when message has been received from node RPC API in [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) format, for example: `"2021-03-23T17:03:03.994Z"`
- `slot` is a [Solana's slot](https://docs.solana.com/terminology#slot) number for which message has produced
- `version` of Serum DEX program layout (DEX version)
- `account` is an open orders account address
- `accountSlot` is a an open orders account slot number
- `price` and `size` are provided as strings to preserve precision

<br/>

#### `recent_trades`

Recent trades (up to 100) ordered by timestamp in ascending order (from oldest to newest) returned immediately after successful subscription, every trade has the same format as `trade` message.

```ts
{
  "type": "recent_trades",
  "market": string,
  "trades": Trade[],
  "timestamp": string
}
```

#### Sample `recent_trades` message

```json
{
  "type": "recent_trades",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T07:05:27.377Z",
  "trades": [
    {
      "type": "trade",
      "market": "BTC/USDC",
      "timestamp": "2021-03-23T19:03:06.723Z",
      "slot": 70468384,
      "version": 3,
      "id": "10239824528804319520203515|3.0821|1616526186723",
      "side": "buy",
      "price": "55447.7",
      "size": "3.0821"
    }
  ]
}
```

<br/>

#### `trade`

```ts
{
  "type": "trade",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "id": string,
  "side": "buy" | "sell",
  "price": string,
  "size": string
}
```

#### Sample `trade` message

```
{
  "type": "trade",
  "market": "BTC/USDC",
  "timestamp": "2021-03-23T19:03:06.723Z",
  "slot": 70468384,
  "version": 3,
  "id": "10239824528804319520203515|3.0821|1616526186723",
  "side": "buy",
  "price": "55447.7",
  "size": "3.0821"
}
```

<br/>
<br/>

## HTTP API

### GET `/markets`

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

<br/>
<br/>

## Architecture

![architecture diagram](https://user-images.githubusercontent.com/51779538/112196249-20567d00-8c0b-11eb-86c9-409c1de75c41.png)

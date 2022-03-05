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

- **[ws://localhost:8000/v1/ws](ws://localhost:8000/v1/ws)** - assuming serum-vial runs locally on default port without SSL enabled

- **[wss://api.serum-vial.dev/v1/ws](wss://api.serum-vial.dev/v1/ws)** - hosted serum-vial server endpoint

<br/>

### Subscribing to data feeds

To begin receiving real-time market data feed messages, you must first send a subscribe message to the server indicating [channels](#supported-channels--corresponding-message-types) and [markets](#supported-markets) for which you want the data for.

If you want to unsubscribe from channel and markets, send an unsubscribe message. The structure is equivalent to subscribe messages except `op` field which should be set to `"op": "unsubscribe"`.

```js
const ws = new WebSocket('ws://localhost:8000/v1/ws')

ws.onopen = () => {
  const subscribeL2 = {
    op: 'subscribe',
    channel: 'trades',
    markets: ['BTC/USDC']
  }

  ws.send(JSON.stringify(subscribeL2))
}
```

<br/>

#### Subscribe/unsubscribe message format

- see [supported channels & corresponding data messages types](#supported-channels--corresponding-message-types)
- see [supported markets](#supported-markets)

```ts
{
  "op": "subscribe" | "unsubscribe",
  "channel": "level3" | "level2" | "level1" | "trades",
  "markets": string[]
}
```

##### sample `subscribe` message

```json
{
  "op": "subscribe",
  "channel": "level2",
  "markets": ["BTC/USDC"]
}
```

<br/>

#### Subscription confirmation message format

Once a subscription (or unsubscription) request is processed by the server, it will push `subscribed` (or `unsubscribed`) confirmation message or `error` if received request message was invalid.

```ts
{
"type": "subscribed" | "unsubscribed",
"channel": "level3" | "level2" | "level1" | "trades",
"markets": string[],
"timestamp": string
}
```

##### sample `subscribed` confirmation message

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

Error message is pushed for invalid subscribe/unsubscribe messages - non existing market, invalid channel name etc.

```ts
{
  "type": "error",
  "message": "string,
  "timestamp": "string
}
```

##### sample `error` message

```json
{
  "type": "error",
  "message": "Invalid channel provided: 'levels1'.",
  "timestamp": "2021-03-23T17:13:31.010Z"
}
```

<br/>
<br/>

### Supported channels & corresponding message types

When subscribed to the channel, server will push the data messages as specified below.

- `trades`

  - [`recent_trades`](#recent_trades)
  - [`trade`](#trade)

- `level1`

  - [`quote`](#quote)

- `level2`

  - [`l2snapshot`](#l2snapshot)
  - [`l2update`](#l2update)

- `level3`

  - [`l3snapshot`](#l3snapshot)
  - [`open`](#open)
  - [`fill`](#fill)
  - [`change`](#change)
  - [`done`](#done)

<br/>
<br/>

### Supported markets

Markets supported by serum-vial server can be queried via [`GET /markets`](#get-markets) HTTP endpoint (`[].name` field).

<br/>
<br/>

### Data messages

- `type` is determining message's data type so it can be handled appropriately

- `timestamp` when message has been received from node RPC API in [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) format with milliseconds, for example: "2021-03-23T17:03:03.994Z"

- `slot` is a [Solana's slot](https://docs.solana.com/terminology#slot) number for which message has produced

- `version` of Serum DEX program layout (DEX version)

- `price` and `size` are provided as strings to preserve precision

<br/>

#### `recent_trades`

Up to 100 recent trades pushed immediately after successful subscription confirmation.

- every trade in `trades` array has the same format as [`trade`](#trade) message
- trades are ordered from oldest to newest

```ts
{
  "type": "recent_trades",
  "market": string,
  "trades": Trade[],
  "timestamp": string
}
```

#### sample `recent_trades` message

```json
{
  "type": "recent_trades",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T07:05:27.377Z",
  "trades": [
    {
      "type": "trade",
      "market": "SOL/USDC",
      "timestamp": "2021-12-23T14:31:16.733Z",
      "slot": 112915164,
      "version": 3,
      "id": "3313016788894161792503559|3313035235638235438412464",
      "side": "sell",
      "price": "179.599",
      "size": "125.4",
      "takerAccount": "AAddgLu9reZCUWW1bNQFaXrCMAtwQpMRvmeusgk4pCM6",
      "makerAccount": "EpAdzaqV13Es3x4dukfjFoCrKVXnZ7y9Y76whgMHo5qx",
      "takerOrderId": "3313016788894161792503559",
      "makerOrderId": "3313035235638235438412464",
      "takerClientId": "875345",
      "makerClientId": "875345",
      "takerFeeCost": -3.2,
      "makerFeeCost": 15.4
    }
  ]
}
```

<br/>

#### `trade`

Pushed real-time for each trade as it happens on a DEX (decoded from the `eventQueue` account).

- `side` describes a liquidity taker side

- `id` field is an unique id constructed by joining fill taker and fill maker order id

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
  "size": string,
  "takerAccount": string,
  "makerAccount": string,
  "takerOrderId": string,
  "makerOrderId": string,
  "takerClientId": string,
  "makerClientId": string,
  "takerFeeCost": number,
  "makerFeeCost": number
}
```

#### sample `trade` message

```
{
  "type": "trade",
  "market": "SOL/USDC",
  "timestamp": "2021-12-23T14:31:16.733Z",
  "slot": 112915164,
  "version": 3,
  "id": "3313016788894161792503559|3313035235638235438412464",
  "side": "sell",
  "price": "179.599",
  "size": "125.4",
  "takerAccount": "AAddgLu9reZCUWW1bNQFaXrCMAtwQpMRvmeusgk4pCM6",
  "makerAccount": "EpAdzaqV13Es3x4dukfjFoCrKVXnZ7y9Y76whgMHo5qx",
  "takerOrderId": "3313016788894161792503559",
  "makerOrderId": "3313035235638235438412464",
  "takerClientId": "875345",
  "makerClientId": "875345",
  "takerFeeCost": -3.2,
  "makerFeeCost": 15.4
}
```

<br/>

### `quote`

Pushed real-time for any change in best bid/ask price or size for a given market (decoded from the `bids` and `asks` accounts).

- `bestAsk` and `bestBid` are tuples where first item is a price and second is a size of the best bid/ask level

```ts
{
  "type": "quote",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "bestAsk": [price: string, size: string] | undefined,
  "bestBid": [price: string, size: string] | undefined
}
```

#### sample `quote` message

```json
{
  "type": "quote",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T07:11:57.186Z",
  "slot": 70544253,
  "version": 3,
  "bestAsk": ["55336.1", "5.0960"],
  "bestBid": ["55285.6", "7.5000"]
}
```

<br/>

### `l2snapshot`

Entire up-to-date order book snapshot with orders aggregated by price level pushed immediately after successful subscription confirmation.

- `asks` and `bids` arrays contain tuples where first item of a tuple is a price level and second one is a size of the resting orders at that price level

- it can be pushed for an active connection as well when underlying server connection to the RPC node has been restarted, in such scenario locally maintained order book should be re-initialized with a new snapshot

- together with [`l2update`](#l2update) messages it can be used to maintain local up-to-date full order book state

```ts
{
  "type": "l2snapshot",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "asks": [price: string, size: string][],
  "bids": [price: string, size: string][]
}
```

#### sample `l2snapshot` message

```json
{
  "type": "l2snapshot",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T09:00:53.087Z",
  "slot": 70555623,
  "version": 3,
  "asks": [
    ["56463.3", "8.6208"],
    ["56474.3", "5.8632"],
    ["56496.4", "3.7627"]
  ],
  "bids": [
    ["56386.0", "4.8541"],
    ["56370.1", "6.8054"],
    ["56286.3", "8.6631"]
  ]
}
```

<br/>

### `l2update`

Pushed real-time for any change to the order book for a given market with updated price levels and sizes since the previous update (decoded from the `bids` and `asks` accounts).

- together with [`l2snapshot`](#l2snapshot), `l2update` messages can be used to maintain local up-to-date full order book state

- `asks` and `bids` arrays contain updates which are provided as a tuples where first item is an updated price level and second one is an updated size of the resting orders at that price level (absolute value, not delta)

- if size is set to `0` it means that such price level does not exist anymore and shall be removed from locally maintained order book

```ts
{
  "type": "l2update",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "asks": [price: string, size: string][],
  "bids": [price: string, size: string][]
}
```

#### sample `l2update` message

```json
{
  "type": "l2update",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T09:00:55.586Z",
  "slot": 70555627,
  "version": 3,
  "asks": [["56511.5", "7.5000"]],
  "bids": [
    ["56421.6", "0.0000"],
    ["56433.6", "5.9475"]
  ]
}
```

<br/>

### `l3snapshot`

Entire up-to-date order book snapshot with **all individual orders** pushed immediately after successful subscription confirmation.

- `clientId` is an client provided order id for an order

- `account` is an open orders account address

- `accountSlot` is a an open orders account slot number

- together with [`open`](#open), [`change`](#change), [`fill`](#fill) and [`done`](#done) messages it can be used to maintain local up to date Level 3 order book state

- it can be pushed for an active connection as well when underlying server connection to the RPC node has been restarted, in such scenario locally maintained L3 order book should be re-initialized with a new snapshot

```ts
{
  "type": "l3snapshot",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "asks": {
    "price": string,
    "size": string,
    "side": "sell",
    "orderId": string,
    "clientId": string,
    "account": string,
    "accountSlot": number,
    "feeTier": number
  }[],
  "bids": {
    "price": string,
    "size": string,
    "side": "buy",
    "orderId": string,
    "clientId": string,
    "account": string,
    "accountSlot": number,
    "feeTier": number
  }[]
}
```

#### sample `l3snapshot` message

```json
{
  "type": "l3snapshot",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T09:49:51.070Z",
  "slot": 70560748,
  "version": 3,
  "asks": [
    {
      "orderId": "10430028906948338708824594",
      "clientId": "13065347387987527730",
      "side": "sell",
      "price": "56541.3",
      "size": "4.9049",
      "account": "EXkXcPkqFwqJPXpJdTHMdvmLE282PRShqwMTteWcfz85",
      "accountSlot": 8,
      "feeTier": 3
    }
  ],
  "bids": [
    {
      "orderId": "10414533641926422683532775",
      "clientId": "1616579378239885365",
      "side": "buy",
      "price": "56457.2",
      "size": "7.5000",
      "account": "6Yqus2UYf1wSaKBE4GSLeE2Ge225THeyPcgWBaoGzx3e",
      "accountSlot": 10,
      "feeTier": 6
    }
  ]
}
```

### `open`

Pushed real-time for every new order opened on the limit order book (decoded from the `bids` and `asks` accounts).

- **no** `open` messages are pushed for order that are filled or canceled immediately, for example - `ImmediateOrCancel` orders

```ts
{
  "type": "open",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "orderId": string,
  "clientId": string,
  "side": "buy" | "sell",
  "price": string,
  "size": string,
  "account": string,
  "accountSlot": number,
  "feeTier": number
}
```

#### sample `open` message

```json
{
  "type": "open",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T10:14:33.967Z",
  "slot": 70563387,
  "version": 3,
  "orderId": "10395754856459386361922812",
  "clientId": "1616580865182472471",
  "side": "sell",
  "price": "56355.5",
  "size": "7.5000",
  "account": "6Yqus2UYf1wSaKBE4GSLeE2Ge225THeyPcgWBaoGzx3e",
  "accountSlot": 6,
  "feeTier": 6
}
```

<br/>

### `change`

Pushed real-time anytime order size changes as a result of self-trade prevention (decoded from the `bids` and `asks` accounts).

- `size` field contains updated order size

```ts
{
  "type": "change",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "orderId": string,
  "clientId": string,
  "side": "buy" | "sell",
  "price": string,
  "size": string,
  "account": string,
  "accountSlot": number,
  "feeTier": number
}
```

#### sample `change` message

```json
{
  "type": "change",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T10:25:21.739Z",
  "slot": 70564525,
  "version": 3,
  "orderId": "10352165200213210691454558",
  "clientId": "15125925100673159264",
  "side": "sell",
  "price": "56119.2",
  "size": "8.4494",
  "account": "EXkXcPkqFwqJPXpJdTHMdvmLE282PRShqwMTteWcfz85",
  "accountSlot": 6,
  "feeTier": 3
}
```

<br/>

### `fill`

Pushed real-time anytime trade happens (decoded from the `eventQueue` accounts).

- there are always two `fill` messages for a trade, one for a maker and one for a taker order

- `feeCost` is provided in a quote currency

```ts
{
  "type": "fill",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "orderId": string,
  "clientId": string,
  "side": "buy" | "sell",
  "price": string,
  "size": string,
  "maker" boolean,
  "feeCost" number,
  "account": string,
  "accountSlot": number,
  "feeTier": number
}
```

#### sample `fill` message

```json
{
  "type": "fill",
  "market": "BTC/USDC",
  "timestamp": "2021-03-24T11:27:21.739Z",
  "slot": 70564527,
  "version": 3,
  "orderId": "1035216520046710691454558",
  "clientId": "151259251006473159264",
  "side": "sell",
  "price": "56119.2",
  "size": "8.4494",
  "maker": false,
  "feeCost": 15.6,
  "account": "EXkXcPkqFwqJPXpJdTHMdvmLE282PRShqwMTteWcfz85",
  "accountSlot": 6,
  "feeTier": 3
}
```

<br/>

### `done`

Pushed real-time when the order is no longer on the order book (decoded from the `eventQueue` accounts).

- this message can result from an order being canceled or filled (`reason` field)

- there will be no more messages for this `orderId` after a `done` message

- it can be pushed for orders that were never `open` in the order book in the first place (`ImmediateOrCancel` orders for example)

- `sizeRemaining` field is available only since v1.3.2 and only for canceled orders (`reason="canceled"`)

```ts
{
  "type": "done",
  "market": string,
  "timestamp": string,
  "slot": number,
  "version": number,
  "orderId": string,
  "clientId": string,
  "side": "buy" | "sell",
  "reason" : "canceled" | "filled",
  "sizeRemaining": string | undefined
  "account": string,
  "accountSlot": number
}
```

### sample `done` message

```json
{
  "type": "done",
  "market": "SRM/USDC",
  "timestamp": "2021-11-16T12:29:12.180Z",
  "slot": 107165458,
  "version": 3,
  "orderId": "117413526029161279193704",
  "clientId": "4796015225289787768",
  "side": "buy",
  "reason": "canceled",
  "account": "AqeHe31ZUDgEUSidkh3gEhkf7iPn8bSTJ6c8L9ymp8Vj",
  "accountSlot": 0,
  "sizeRemaining": "508.5"
}
```

###

<br/>
<br/>

## HTTP API

### GET `/markets`

Returns Serum DEX markets list supported by serum-vial instance (it can be updated by providing custom markets.json file).

<br/>

### Endpoint URL

- [http://localhost:8000/v1/markets](http://localhost:8000/v1/markets) - assuming serum-vial runs locally on default port without SSL enabled

- [https://api.serum-vial.dev/v1/markets](https://api.serum-vial.dev/v1/markets) - hosted serum-vial server endpoint

<br/>

### Response format

```ts
{
  "name": string,
  "baseMintAddress": string,
  "quoteMintAddress": string,
  "version": number,
  "address": string,
  "programId": string,
  "baseCurrency": string,
  "quoteCurrency": string,
  "tickSize": number,
  "minOrderSize": number,
  "deprecated": boolean
}[]
```

#### sample response

```json
[
  {
    "name": "BTC/USDC",
    "baseCurrency": "BTC",
    "quoteCurrency": "USDC",
    "version": 3,
    "address": "A8YFbxQYFVqKZaoYJLLUVcQiWP7G2MeEgW5wsAQgMvFw",
    "programId": "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    "baseMintAddress": "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
    "quoteMintAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "tickSize": 0.1,
    "minOrderSize": 0.0001,
    "deprecated": false
  }
]
```

<br/>
<br/>

## Architecture

![architecture diagram](https://user-images.githubusercontent.com/51779538/112750634-f4037d80-8fc9-11eb-8ce3-a0798b6790e8.png)

<br/>
<br/>

## Credits

##### This project was possible thanks to [ecoSerum Grant](https://projectserum.com/grants).

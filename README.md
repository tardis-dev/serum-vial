# Serum Machine

[![Version](https://img.shields.io/npm/v/serum-machine.svg)](https://www.npmjs.org/package/serum-machine)

Real-time market data API server for Serum DEX

<br/>

## Installation options

- ### npx <sub>(requires Node.js >= 12 installed on host machine)</sub>

  That will start Serum Machine server running on port `8000` by default (port can be changed via `--port`)

  ```sh
  npx serum-machine
  ```

  If you'd like to switch to different Serum Node endpoint simply run the command with --endpoint option like this:

  ```sh
  npx serum-machine --endpoint https://testnet.solana.com
  ```

  Run `npx serum-machine --help` to see all available startup options (node endpoint url, port etc.)
  <br/>
  <br/>

- ### npm <sub>(requires Node.js >= 12 installed on host machine)</sub>

  Installs `serum-machine` globally.

  ```sh
  npm install -g serum-machine
  serum-machine
  ```

  If you'd like to switch to different Serum Node endpoint simply run the command with --endpoint option like this:

  ```sh
  serum-machine --endpoint https://testnet.solana.com
  ```

  Run `serum-machine --help` to see all available startup options (node endpoint url, port etc.)
  <br/>
  <br/>

- ### Docker

  ```sh
  docker run -p 8000:8000 -e "TM_ENDPOINT=https://testnet.solana.com" -d tardisdev/serum-machine
  ```

  Command above will pull and run latest version of [`tardisdev/serum-machine` image](https://hub.docker.com/r/tardisdev/serum-machine). Serum Matchine server will available on host via `8000` port (for example [http://localhost:8000/v1/markets](http://localhost:8000/v1/markets)).
  <br/>
  <br/>

## HTTP endpoints

### `/markets`

Accepts no params and returns supported Serum markets.

#### Sample response

```json
[
  {
    "name": "ALEPH/USDT",
    "address": "EmCzMQfXMgNHcnRoFwAdPe1i2SuiSzMj1mx6wu3KN2uA",
    "programId": "4ckmDgGdxQoPDLUkDT3vHgSAkzA3QRdNq5ywwY4sUSJn",
    "deprecated": false
  },
  {
    "name": "ALEPH/USDC",
    "address": "B37pZmwrwXHjpgvd9hHDAx1yeDsNevTnbbrN9W12BoGK",
    "programId": "4ckmDgGdxQoPDLUkDT3vHgSAkzA3QRdNq5ywwY4sUSJn",
    "deprecated": false
  },
  {
    "name": "BTC/USDT",
    "address": "8AcVjMG2LTbpkjNoyq8RwysokqZunkjy3d5JDzxC6BJa",
    "programId": "4ckmDgGdxQoPDLUkDT3vHgSAkzA3QRdNq5ywwY4sUSJn",
    "deprecated": false
  }
]
```

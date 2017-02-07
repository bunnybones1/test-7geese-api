##Getting Started##

This is a mashup of 7Geese API and many cool things, so these instructions will be dense.

Once you clone this repo, run `npm i`

Generate a self-signed key to `client-cert.pem` and `client-key.pem` (use 1024 bit encryption)

Create a `.env` file with the following information (replace with your own):


```
SEVEN_GEESE_CLIENT_ID=1234567890
SEVEN_GEESE_CLIENT_SECRET=12345678901234567890
CLIENT_SESSIONS_SECRET=ANY_RANDOM_THING
SKYBIOMETRY_API_KEY=1234567890
SKYBIOMETRY_API_SECRET=1234567890
```

Install imagemagick on your computer.

Install Mongodb on your computer.

Run `npm run server`, give it 2 seconds to start up, and navigate to https://localhost:8001 (Ignore privacy warning)
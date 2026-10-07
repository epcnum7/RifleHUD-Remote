# RifleHUD Web Bluetooth remote

This static mobile page controls the existing RifleHUD BLE service without a
native iPhone build. On iPhone it must be opened in a browser that implements
Web Bluetooth, such as Bluefy; Safari does not expose `navigator.bluetooth`.

Deployed controller: <https://epcnum7.github.io/RifleHUD-Remote/>

The page sends one command at a time, waits for its matching acknowledgement,
then requests a current status snapshot. Web client v0.8 sends target, range,
density altitude, and wind through one atomic **Save All** command. Manual
elevation remains a separate action. It does not contain ballistic tables or
credentials.

Serve this directory over HTTPS. Plain HTTP works only on `localhost` during
desktop development because Web Bluetooth requires a secure context. The
service worker caches the static shell after a successful load, but offline
behavior still depends on the host browser.

## Physical test

1. Flash and power the BLE-first StickS3 firmware.
2. Install Bluefy on the iPhone and open the deployed HTTPS URL in Bluefy.
3. Tap Connect and choose `RifleHUD`.
4. Enter the six-digit PIN shown on the StickS3 if iOS requests it.
5. Verify Refresh, Save All with calm and nonzero wind, and manual elevation.
6. Restart the HUD and verify that Connect restores the saved values.

The current firmware protocol does not have clear-range or clear-override
commands, so the web client does not expose controls that cannot be honored.

# RifleHUD Web Bluetooth remote

This static mobile page controls the existing RifleHUD BLE service without a
native iPhone build. On iPhone it must be opened in a browser that implements
Web Bluetooth, such as Bluefy; Safari does not expose `navigator.bluetooth`.

Deployed controller: <https://epcnum7.github.io/RifleHUD-Remote/>

The page sends one command at a time, waits for its matching acknowledgement,
then requests current solution and target-plan snapshots. Web client v0.11
selects **DOPE Card** or **Auto** mode and saves up to six ID/range pairs, an
independent display checkbox for each row, density altitude, and wind through
one atomic **Save Mode and Plan** command. Manual elevation remains a separate
action. It also starts and reports the experimental KILO3000BDX
discovery/capture probe. It does not contain ballistic tables or credentials.

Serve this directory over HTTPS. Plain HTTP works only on `localhost` during
desktop development because Web Bluetooth requires a secure context. The
service worker caches the complete static shell after a successful load. Wait
for **Offline access ready**, then close and reopen the same URL once with the
phone in airplane mode to verify the browser retained it. BLE does not require
internet, but offline service-worker behavior still depends on Bluefy/iOS.

## Physical test

1. Flash and power the BLE-first StickS3 firmware.
2. Install Bluefy on the iPhone and open the deployed HTTPS URL in Bluefy.
3. Tap Connect and choose `RifleHUD`.
4. Enter the six-digit PIN shown on the StickS3 if iOS requests it.
5. Save two or more targets in DOPE Card mode, choose a subset with the SHOW
   checkboxes, and verify only those rows appear on the StickS3.
6. Restart the HUD and verify that Connect restores the saved values.
7. After **Offline access ready**, disable internet access, reopen the page,
   and reconnect over BLE.
8. Put the KILO3000BDX in ABE/ABX mode, tap **Discover KILO**, and confirm the
   page reaches `MONITORING` before capturing repeated known-distance ranges
   over USB serial.
9. Select Auto mode and verify that saved target ranges no longer drive the
   full-size HUD. Until the captured KILO payload is decoded and validated,
   the device must show `WAITING FOR KILO` rather than reuse an old range.

The current firmware protocol does not have clear-range or clear-override
commands, so the web client does not expose controls that cannot be honored.

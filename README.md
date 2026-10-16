# RifleHUD Web Bluetooth remote

This static mobile page controls the existing RifleHUD BLE service without a
native iPhone build. On iPhone it must be opened in a browser that implements
Web Bluetooth, such as Bluefy; Safari does not expose `navigator.bluetooth`.

Deployed controller: <https://epcnum7.github.io/RifleHUD-Remote/>

The page sends one command at a time and waits for its matching
acknowledgement. Web client v0.14 selects **DOPE Card** or **Auto** and saves
the checked target rows, density altitude, and wind through one atomic
**Save Mode and Plan** command. Target IDs start as T1 through T6. Check a
row and enter its range. Unchecked rows are left off the card. The mode does
not change until that save. Manual elevation is a separate action. The page
does not search for or control the binoculars. In Auto the Stick starts that
link on its own. The page does not contain ballistic tables or credentials.

The current page button reads **Save Mode and Plan**. An older published copy
that still says Save Target Plan, Discover KILO, or ABE/ABX does not match
this Stick.

Serve this directory over HTTPS. Plain HTTP works only on `localhost` during
desktop development because Web Bluetooth requires a secure context. The
service worker caches the page after a successful load. The first visit, and
any later update of the page, needs a network. Wait for **Offline access
ready**. Bluetooth control then works with the phone offline. Installing new
firmware still needs a computer. Offline caching still depends on the current
Bluefy and iOS versions.

## Use

1. Power the StickS3. It advertises as `RifleHUD`.
2. Open the HTTPS URL in Bluefy.
3. Tap Connect and choose `RifleHUD`.
4. Enter the six-digit PIN shown on the Stick if iOS requests it.
5. Choose **DOPE Card** or **Auto**. Enter density altitude. Leave wind blank
   or enter 0 for calm. For the card, check a row and enter its range. The
   IDs already read T1 through T6. Auto ignores those saved ranges.
6. Tap **Save Mode and Plan** once. If the phone drops during the save,
   reconnect, tap Refresh, and confirm the values.
7. For Auto, put the KILO3000BDX in ABU mode and keep it awake. The Stick
   searches on its own. The hold on the Stick updates with each measurement,
   including a distance between chart rows. A dropped link leaves the last
   range on the Stick until a newer one arrives.
8. On the Stick, hold the side button for 1.5 seconds to switch between Auto
   and DOPE Card without the phone. In Auto, a short side-button press freezes
   the range (`HOLD`) and a short front-button press cycles brightness. Hold
   both buttons for 1.5 seconds only when you mean to open the Wi-Fi fallback.
   The BLE PIN on the Stick is for the phone. The binoculars never use it.
9. DOPE Card shows only the checked rows. Restart the Stick and reconnect to
   confirm the saved plan returned. The last binocular range, freeze, and
   brightness do not return after power-off.
10. After **Offline access ready**, disable internet, reopen the same URL in
    Bluefy, and connect again.

The current firmware protocol does not have clear-range or clear-override
commands, so the web client does not expose controls that cannot be honored.

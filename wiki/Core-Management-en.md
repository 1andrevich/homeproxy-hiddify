🇬🇧 [English](Core-Management-en) | 🇷🇺 [Русский](Core-Management-ru)

# Core Management

Re:HomeProxy is **multi-core**: the LuCI app is the interface, and a separate **core** binary does the actual proxying. You install, update, and switch cores from **Services → Re:HomeProxy → Status → Core Management** — no SSH required.

---

## Choosing a core

| | **hiddify-core** (default) | **sing-box-extended** |
|---|---|---|
| Engine | Fork of sing-box by the Hiddify team | Fork of sing-box with extra build tags |
| Footprint | Lighter; a **compact build** exists for small devices | Larger (~76 MB installed) |
| Protocols | Hiddify-app protocols, TLS fragment, XHTTP, Mieru, etc. | The widest protocol set… |
| **AmneziaWG / WARP** | ❌ **Not supported** | ✅ **Supported** |

**Rule of thumb:** if you need **AmneziaWG/WARP**, or want the broadest protocol coverage and have ~80 MB free, choose **sing-box-extended**. Otherwise **hiddify-core** is the lighter default and is the only one with a compact build for tight-storage routers.

Which protocols appear in the node editor depends on the core you install — see [Supported Protocols](Supported-Protocols-en).

---

## Installing — one smart button

Core Management has a single **Install** button per core. It does **not** ask you to choose between "standard" and "compressed" builds — instead it inspects your device and picks a build that actually fits:

1. It reads the free space on `/overlay` (persistent flash) and your free RAM.
2. For hiddify-core: if the full build fits → it installs the **standard** build. If storage is tight but there's enough RAM → it installs the **compact** build and tells you so.
3. If neither can fit → it stops with a clear message instead of installing something broken.

### Why the guardrail matters

A core binary that is **larger than the free overlay** gets **truncated** as it's written, and then crashes with a **"bus error" (SIGBUS)** the moment it's launched — a confusing failure that looks like a corrupt download. The installer's size check exists specifically to prevent this: it never offers a build the device can't hold.

### The compact build

The compact (UPX-compressed) build of hiddify-core is much smaller on flash, but it **decompresses into RAM each time it launches** — trading flash space for memory. The installer only picks it when there's enough free RAM, and shows a note like *"Limited storage — installing the compact build (decompresses into RAM at launch)."* On most routers this is invisible in day-to-day use.

---

## Storage at a glance

| Free on `/overlay` | What installs |
|--------------------|---------------|
| ~80 MB+ | hiddify-core or sing-box-extended (full build) |
| ~25–80 MB | hiddify-core (compact build, if RAM allows) |
| < ~25 MB | Not enough — free space, or bake the core into a custom firmware image |

> On a **compressing** overlay (jffs2/ubifs) the full build needs less free space than the raw figure, because the filesystem compresses it. The installer accounts for this automatically — trust its check over the table above.

Tight on flash but building your own image? Large cores fit comfortably when **baked into the SquashFS** root at image-build time (the SquashFS root is compressed and read-only), rather than installed into the writable overlay.

---

## Switching cores and updating

- **Update:** press **Install** again — it fetches the latest release and reinstalls.
- **Switch cores:** install the other core; if both are present, Re:HomeProxy uses your **preferred core** setting. The config generator and the service honour the same preference, so the generated config always matches the core that will run it.
- **Version / status:** Core Management shows the installed core and version. If it shows all `?`, the backend (rpcd) is stale — restart it (`/etc/init.d/rpcd restart`) and reload the page.

---

## Kernel modules

The proxy needs `kmod-nft-tproxy` and `kmod-tun` for transparent routing. The installer pulls these in; if routing doesn't work after a fresh install, confirm they're present.

See also: [ByeDPI](ByeDPI-en) · [Supported Protocols](Supported-Protocols-en) · [Troubleshooting](Troubleshooting-en)

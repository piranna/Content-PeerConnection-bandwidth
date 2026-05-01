# Content-PeerConnection-bandwidth

A WebRTC benchmarking sandbox for codec bitrate analysis.

[![DOI](https://zenodo.org/badge/1107197673.svg)](https://doi.org/10.5281/zenodo.19961277)

A practical WebRTC benchmarking sandbox to study how much bitrate is needed to
send video at different codecs, resolutions, and frame rates.

This repository starts from the classic WebRTC “adjust bandwidth” sample and
extends it to:

- force a single selected codec,
- run controlled loopback calls,
- collect per-second sender stats (bitrate and packets/s),
- export copy/paste-ready CSV rows,
- aggregate results into a comparative multi-codec chart.

The project is intentionally simple: browser-native test harness + one small
Node.js plotting script.

## Related Article

For the full methodology, analysis and conclusions, see
[WebRTC bitrate is not what you think](https://piranna.github.io/2026/04/28/WebRTC-bitrate-is-not-what-you-think/)

## Table of contents

1. [What this project does](#what-this-project-does)
2. [How it works (high-level)](#how-it-works-high-level)
3. [Repository structure](#repository-structure)
4. [Runtime architecture and data flow](#runtime-architecture-and-data-flow)
5. [Key implementation details](#key-implementation-details)
6. [How to run](#how-to-run)
7. [How to collect benchmark data](#how-to-collect-benchmark-data)
8. [How to generate and read charts](#how-to-generate-and-read-charts)
9. [Current dataset notes](#current-dataset-notes)
10. [Methodology guidance (for reproducible results)](#methodology-guidance-for-reproducible-results)
11. [Limitations and caveats](#limitations-and-caveats)
12. [Possible next improvements](#possible-next-improvements)
13. [License](#license)

## What this project does

At a glance, this tool lets you run a local WebRTC loopback call and answer
questions like:

- How does average and peak sender bitrate change with resolution?
- How do codecs compare under very low spatial detail (tiny resolutions) vs
  standard VGA?
- How many RTP packets per second are produced for each configuration?
- Where does each codec begin to “cost too much” in bitrate for a given visual
  setup?

The main output is a compact CSV format per test run:

```csv
codec,width,height,framerate,max_bps,avg_bps,max_packets,avg_packets
```

You can then accumulate rows in [stats.csv](./stats.csv), and generate a
comparative chart ([`bitrate_chart.html`](./bitrate_chart.html)) from those
measurements.

## How it works (high-level)

1. Open the test page ([`index.html`](./index.html)) in a browser. It needs to
   be served from an HTTPS origin to access camera and run WebRTC.
2. Choose codec, resolution, frame rate, and whether to use synthetic video.
3. Start call (local peer connection to remote peer connection in the same
   page).
4. Every second, read outbound RTP stats from the sender.
5. Compute instantaneous bitrate and packets/s deltas.
6. Update live graphs and maintain accumulators (max and average).
7. Show a ready-to-copy CSV row in the UI.

Once you have the CSV rows, you can:

1. Append the rows manually into `stats.csv`.
2. Run `npm run plot` to generate a static interactive chart page.

A possible improvement for the future would be to directly download the CSV file
or the chart from the browser, but for now the manual copy step keeps the
implementation simple and transparent.

## Repository structure

```text
.
├── index.html                 # Main interactive WebRTC benchmark page
├── js/main.js                 # Core WebRTC logic + stats computation + CSV row export
├── js/third_party/graph.js    # Timeline graph helper (from WebRTC internals sample ecosystem)
├── css/main.css               # Local styles for video controls and graph layout
├── stats.csv                  # Collected benchmark samples (input dataset)
├── scripts/plot_bitrate.js    # Node script that transforms CSV into Chart.js HTML
├── bitrate_chart.html         # Generated chart page from stats.csv
├── package.json               # Node dependencies and scripts
├── LICENSE
└── README.md
```

## Runtime architecture and data flow

### 1) Call setup and media source

`js/main.js` supports two video sources:

- **Live camera stream** via `getUserMedia()`
- **Synthetic stream** generated from a canvas (`captureStream()`), with moving
  colored blocks

The synthetic mode is useful to reduce external variability (lighting changes,
camera auto-exposure, scene complexity).

### 2) Peer connections (loopback)

The page creates two RTCPeerConnections:

- `pc1` (sender side)
- `pc2` (receiver side)

Tracks from local stream are added to `pc1`, and then classic offer/answer
exchange is performed between `pc1` and `pc2` in-page.

### 3) Codec selection and enforcement

On load, the app queries `RTCRtpSender.getCapabilities('video')`, filters out
non-media codecs (`rtx`, `red`, `ulpfec`, `flexfec`), and populates a codec
selector.

If user selects a codec, the app calls `setCodecPreferences([selectedCodec])` on
the video transceiver before offer creation. After negotiation, it verifies the
negotiated codec from sender parameters and fails fast if mismatch or fallback
codecs appear.

This strict validation is important for trustworthy per-codec comparisons.

### 4) Bandwidth limiting

The bandwidth dropdown applies limits in kbps.

Preferred path:

- `RTCRtpSender.setParameters()` with `encodings[0].maxBitrate`

Fallback path:

- SDP rewriting (`b=AS` or `b=TIAS` for Firefox) and local renegotiation.

### 5) Stats polling and metrics

A 1-second interval reads `sender.getStats()` and processes only local
`outbound-rtp` reports.

From current vs previous sample, it computes:

- **Bitrate (bps)**

  $$\text{bitrate} = 8 \cdot \frac{\Delta bytesSent}{\Delta t} \cdot 1000$$

- **Header bitrate (bps)** using `headerBytesSent`

  $$\text{header bitrate} = 8 \cdot \frac{\Delta headerBytesSent}{\Delta t} \cdot 1000$$

- **Packets per second (pps)**

  $$\text{pps} = \Delta packetsSent$$

It updates:

- live bitrate graph,
- live packet graph,
- text counters,
- rolling accumulators for max/average.

### 6) CSV row export

`updateCsvRow()` builds one line with:

- negotiated/selected codec name,
- effective width/height/frame rate (using track settings when possible),
- max and average bitrate,
- max and average packets/s.

This line is shown in the UI (`<code id="csvLine">...`) for manual copy/paste
into `stats.csv`.

## Key implementation details

### Codec discovery strategy

- Uses browser capabilities at runtime.
- Shows codec FMTP details in selector label when available.
- Avoids pseudo-codecs that are transport-level helpers.

### Safety checks for benchmark integrity

- Fails if selected codec is not the negotiated one.
- Fails if more than one codec remains active in sender params.
- Resets metric accumulators at each call start.

### Why "packets per second" is tracked

Bitrate alone can hide packetization overhead. Packet rate adds insight into
transport behavior and helps compare encoding efficiency and RTP framing
side-effects between codecs/settings.

### Included graph helper

[js/third_party/graph.js](js/third_party/graph.js) is a timeline utility
commonly used in WebRTC sample contexts (adapted from
`chrome://webrtc-internals` style tooling) for lightweight live plotting.

## How to run

### Prerequisites

- Node.js 18+ (recommended)
- A modern WebRTC browser (Chromium-based, Firefox, Safari with varying feature
  support)

### Install dependencies

```sh
npm install
```

### Start local server

```sh
npm start
```

This runs [serve](https://www.npmjs.com/package/serve) and hosts the project
locally.

### Open the benchmark UI

Open the served `index.html` URL in your browser.

> Tip: grant camera permission if testing with live input; use synthetic mode
> for controlled repeatable runs.

## How to collect benchmark data

Recommended per test point:

1. Set codec, width, height, fps, and synthetic/live mode.
2. Click **Call**.
3. Let it stabilize for several seconds (longer for low fps setups).
4. Read CSV row shown under the charts.
5. Copy row into `stats.csv`.
6. Click **Hang Up**.
7. Repeat for next configuration.

### Practical suggestions

- Keep one variable changing at a time (e.g., only resolution).
- Run multiple repeats for each point and average externally if needed.
- Keep browser, machine load, and thermal state as stable as possible.

## How to generate and read charts

### Generate chart page from CSV

```sh
npm run plot
```

This executes `scripts/plot_bitrate.js` and writes `bitrate_chart.html`.

### What the chart contains

- X-axis: resolution (`WxH`) sorted by total pixels.
- Y-axis: bitrate in **kbps** (`avg_bps / 1000`, `max_bps / 1000`).
- One color per codec.
- Solid line = average bitrate.
- Dashed line = max bitrate.

### Data filtering behavior in plot script

- Rows without `codec`, `width`, `height`, or `avg_bps` are dropped.
- `max_bps` series is included per codec only if at least one row has max data.
- Missing points are rendered as gaps (`null` with `spanGaps: true`).

## Current dataset notes

The bundled [stats.csv](stats.csv) already includes samples for:

- H264
- VP8
- VP9
- AV1

And spans from very small resolutions (`2x2`) up to `640x480`, mostly at `1 fps`
plus selected `30 fps` points. Lower resolutions made codecs to collapse.

Because the dataset combines manual runs, expect mixed completeness (some
missing max/packet values). The plotting script is designed to tolerate that.

## Methodology guidance (for reproducible results)

For consistent comparisons:

- Prefer synthetic video mode for baseline codec behavior.
- Fix frame rate while scanning resolution (or vice versa).
- Use same browser version across all runs.
- Avoid background CPU-intensive tasks.
- Consider warm-up runs before recording final points.

If your goal is "minimum useful bitrate", define a quality acceptance criterion
explicitly (subjective score or objective proxy) and annotate rows accordingly
in an extended CSV.

## Limitations and caveats

- This is a **single-machine loopback** test, not a real network path benchmark.
- Browser codec implementations and defaults vary by version/platform.
- Camera source complexity can heavily influence bitrate (use synthetic for
  control).
- Packet stats come from sender-side RTP counters only.
- Manual CSV copy introduces potential human error.
- The generated chart is static output from the current [stats.csv](stats.csv)
  snapshot and must be regenerated after dataset changes.

## Possible next improvements

If you want to evolve this benchmark:

- Add automated CSV append (download or local persistence).
- Add confidence intervals from repeated runs.
- Add frame drop / effective fps / keyframe rate metrics.
- Add resolution-vs-fps heatmaps by codec.
- Add bitrate-vs-packets scatter and CDF plots.
- Add CLI options to generate multiple chart types from one dataset.

## Citing

If you reference this work, please cite the article:

```text
Leganés-Combarro, Jesús (2026).
"WebRTC bitrate is not what you think"
https://piranna.github.io/2026/04/28/WebRTC-bitrate-is-not-what-you-think/
```

This repository contains the reference implementation used in the article.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

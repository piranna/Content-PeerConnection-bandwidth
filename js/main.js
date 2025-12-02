/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* global TimelineDataSeries, TimelineGraphView */

'use strict';

const remoteVideo = document.querySelector('video#remoteVideo');
const localVideo = document.querySelector('video#localVideo');
const callButton = document.querySelector('button#callButton');
const hangupButton = document.querySelector('button#hangupButton');
const bandwidthSelector = document.querySelector('select#bandwidth');
const codecSelector = document.querySelector('select#codecSelector');
const settingsFieldset = document.querySelector('fieldset#settingsFieldset');
const width = document.querySelector('input#width');
const height = document.querySelector('input#height');
const frameRate = document.querySelector('input#frameRate');
const synthetic = document.querySelector('input#synthetic');

hangupButton.disabled = true;
callButton.onclick = call;
hangupButton.onclick = hangup;

let availableCodecs = [];
let selectedCodec = null;
let negotiatedCodecName = '';

let bitrateMax = 0;
let bitrateSum = 0;
let bitrateSamples = 0;

let ppsMax = 0;
let ppsSum = 0;

function resetMetrics() {
  bitrateMax = 0;
  bitrateSum = 0;
  bitrateSamples = 0;
  ppsMax = 0;
  ppsSum = 0;
  negotiatedCodecName = '';
  const csvEl = document.getElementById('csvLine');
  if (csvEl) {
    csvEl.textContent = 'codec,width,height,framerate,max_bps,avg_bps,max_packets,avg_packets';
  }
}

let pc1;
let pc2;
let localStream;

// Can be set in the console before making a call to test this keeps
// within the envelope set by the SDP. In kbps.
// eslint-disable-next-line prefer-const
let maxBandwidth = 0;

let bitrateGraph;
let bitrateSeries;
let headerrateSeries;

let packetGraph;
let packetSeries;

let lastResult;

let lastRemoteStart = 0;

// lastRemoteFullSizeDelay is designed to be picked up by a test script.
// eslint-disable-next-line no-unused-vars
let lastRemoteFullSizeDelay = 0;

const offerOptions = {
  offerToReceiveAudio: 0,
  offerToReceiveVideo: 1
};

remoteVideo.addEventListener('resize', ev => {
  const elapsed = performance.now() - lastRemoteStart;
  console.log(elapsed, ': Resize event, size ',
      remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
  if (localVideo.videoWidth == remoteVideo.videoWidth &&
      localVideo.videoHeight == remoteVideo.videoHeight) {
    lastRemoteFullSizeDelay = elapsed;
    console.log('Full size achieved');
  }
});

// Get available video codecs and populate selector
async function getAvailableCodecs() {
  const pc = new RTCPeerConnection();
  pc.addTransceiver('video');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const capabilities = RTCRtpSender.getCapabilities('video');
  if (!capabilities) {
    console.error('RTCRtpSender.getCapabilities not supported');
    codecSelector.innerHTML = '<option value="">No codecs available</option>';
    pc.close();
    return;
  }

  availableCodecs = capabilities.codecs.filter(codec => {
    if (!codec.mimeType.startsWith('video/')) return false;
    const codecName = codec.mimeType.split('/')[1].toLowerCase();
    // Filter out RTX, RED, and FEC (not real video codecs)
    return codecName !== 'rtx' && codecName !== 'red' && codecName !== 'ulpfec' && codecName !== 'flexfec';
  });

  codecSelector.innerHTML = '';
  availableCodecs.forEach((codec, index) => {
    const option = document.createElement('option');
    option.value = index;
    const codecName = codec.mimeType.split('/')[1];
    const sdpFmtpLine = codec.sdpFmtpLine || '';
    option.text = `${codecName}${sdpFmtpLine ? ' (' + sdpFmtpLine + ')' : ''}`;
    codecSelector.appendChild(option);
  });

  pc.close();
  console.log('Available codecs:', availableCodecs);
}

codecSelector.onchange = () => {
  selectedCodec = availableCodecs[codecSelector.value];
  console.log('Selected codec:', selectedCodec);
};

// Initialize codec list on page load
getAvailableCodecs();


function gotStream(stream) {
  hangupButton.disabled = false;
  console.log('Received local stream');
  localStream = stream;
  localVideo.srcObject = stream;
  localStream.getTracks().forEach(track => pc1.addTrack(track, localStream));
  console.log('Adding Local Stream to peer connection');

  // Set codec preferences before creating offer if a codec is selected
  if (selectedCodec) {
    setCodecPreferences();
  }

  pc1.createOffer(
      offerOptions
  ).then(
      gotDescription1,
      onCreateSessionDescriptionError
  );

  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView('bitrateGraph', 'bitrateCanvas');
  bitrateGraph.updateEndDate();

  headerrateSeries = new TimelineDataSeries();
  headerrateSeries.setColor('green');

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView('packetGraph', 'packetCanvas');
  packetGraph.updateEndDate();
}

function onCreateSessionDescriptionError(error) {
  console.log('Failed to create session description: ' + error.toString());
}

function call() {
  callButton.disabled = true;
  settingsFieldset.disabled = true;
  bandwidthSelector.disabled = false;
  console.log('Starting call');
  resetMetrics();
  const servers = null;
  pc1 = new RTCPeerConnection(servers);
  console.log('Created local peer connection object pc1');
  pc1.onicecandidate = onIceCandidate.bind(pc1);

  pc2 = new RTCPeerConnection(servers);
  console.log('Created remote peer connection object pc2');
  pc2.onicecandidate = onIceCandidate.bind(pc2);
  pc2.ontrack = gotRemoteStream;

  const video = {
    frameRate: frameRate.value, width: width.value, height: height.value
  };

  if (synthetic.checked) {
    console.log('Requesting synthetic local stream');
    gotStream(syntheticVideoStream(video));
  } else {
    console.log('Requesting live local stream');
    navigator.mediaDevices.getUserMedia({video})
        .then(gotStream)
        .catch(e => alert('getUserMedia() error: ' + e.name));
  }
}

function gotDescription1(desc) {
  console.log('Offer from pc1 \n' + desc.sdp);

  pc1.setLocalDescription(desc).then(
      () => {
        pc2.setRemoteDescription(desc)
            .then(() => pc2.createAnswer().then(gotDescription2, onCreateSessionDescriptionError),
                onSetSessionDescriptionError);
      }, onSetSessionDescriptionError
  );
}

function gotDescription2(desc) {
  pc2.setLocalDescription(desc).then(
      () => {
        console.log('Answer from pc2 \n' + desc.sdp);

        let p;
        if (maxBandwidth) {
          p = pc1.setRemoteDescription({
            type: desc.type,
            sdp: updateBandwidthRestriction(desc.sdp, maxBandwidth)
          });
        } else {
          p = pc1.setRemoteDescription(desc);
        }
        p.then(() => {
          // Verify codec after negotiation if one was selected
          if (selectedCodec) {
            verifyNegotiatedCodec();
          }
        }, onSetSessionDescriptionError);
      },
      onSetSessionDescriptionError
  );
}

function hangup() {
  console.log('Ending call');
  localStream.getTracks().forEach(track => track.stop());
  pc1.close();
  pc2.close();
  pc1 = null;
  pc2 = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
  settingsFieldset.disabled = false;
  bandwidthSelector.disabled = true;
}

function gotRemoteStream(e) {
  if (remoteVideo.srcObject !== e.streams[0]) {
    remoteVideo.srcObject = e.streams[0];
    console.log('Received remote stream');
    lastRemoteStart = performance.now();
    lastRemoteFullSizeDelay = 0;
  }
}

function getOtherPc(pc) {
  return pc === pc1 ? pc2 : pc1;
}

function getName(pc) {
  return pc === pc1 ? 'pc1' : 'pc2';
}

function onIceCandidate(event) {
  getOtherPc(this)
      .addIceCandidate(event.candidate)
      .then(onAddIceCandidateSuccess)
      .catch(onAddIceCandidateError);

  console.log(`${getName(this)} ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess() {
  console.log('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  console.log('Failed to add ICE Candidate: ' + error.toString());
}

function onSetSessionDescriptionError(error) {
  console.log('Failed to set session description: ' + error.toString());
}

// renegotiate bandwidth on the fly.
bandwidthSelector.onchange = () => {
  bandwidthSelector.disabled = true;
  const bandwidth = bandwidthSelector.options[bandwidthSelector.selectedIndex].value;
  setBandwidth(bandwidth)
      .then(() => {
        bandwidthSelector.disabled = false;
      });
};

function setBandwidth(bandwidthInKbps) {
  // In modern browsers, use RTCRtpSender.setParameters to change bandwidth without
  // (local) renegotiation. Note that this will be within the envelope of
  // the initial maximum bandwidth negotiated via SDP.
  if ((adapter.browserDetails.browser === 'chrome' ||
       adapter.browserDetails.browser === 'safari' ||
       (adapter.browserDetails.browser === 'firefox' &&
        adapter.browserDetails.version >= 64)) &&
      'RTCRtpSender' in window &&
      'setParameters' in window.RTCRtpSender.prototype) {
    const sender = pc1.getSenders()[0];
    const parameters = sender.getParameters();
    if (!parameters.encodings) {
      parameters.encodings = [{}];
    }
    if (bandwidthInKbps === 'unlimited') {
      delete parameters.encodings[0].maxBitrate;
    } else {
      parameters.encodings[0].maxBitrate = bandwidthInKbps * 1000;
    }
    return sender.setParameters(parameters);
  }
  // Fallback to the SDP changes with local renegotiation as way of limiting
  // the bandwidth.
  return pc1.createOffer()
      .then(offer => pc1.setLocalDescription(offer))
      .then(() => {
        const desc = {
          type: pc1.remoteDescription.type,
          sdp: bandwidthInKbps === 'unlimited' ?
          removeBandwidthRestriction(pc1.remoteDescription.sdp) :
          updateBandwidthRestriction(pc1.remoteDescription.sdp, bandwidthInKbps)
        };
        console.log('Applying bandwidth restriction to setRemoteDescription:\n' +
        desc.sdp);
        return pc1.setRemoteDescription(desc);
      })
      .catch(onSetSessionDescriptionError);
};

function updateBandwidthRestriction(sdp, bandwidth) {
  let modifier = 'AS';
  if (adapter.browserDetails.browser === 'firefox') {
    bandwidth = (bandwidth >>> 0) * 1000;
    modifier = 'TIAS';
  }
  if (sdp.indexOf('b=' + modifier + ':') === -1) {
    // insert b= after c= line.
    sdp = sdp.replace(/c=IN (.*)\r\n/, 'c=IN $1\r\nb=' + modifier + ':' + bandwidth + '\r\n');
  } else {
    sdp = sdp.replace(new RegExp('b=' + modifier + ':.*\r\n'), 'b=' + modifier + ':' + bandwidth + '\r\n');
  }
  return sdp;
}

function removeBandwidthRestriction(sdp) {
  return sdp.replace(/b=AS:.*\r\n/, '').replace(/b=TIAS:.*\r\n/, '');
}

function setCodecPreferences() {
  const transceivers = pc1.getTransceivers();
  const videoTransceiver = transceivers.find(t => t.sender.track?.kind === 'video');

  if (!videoTransceiver) {
    const errorMsg = 'ERROR: No video transceiver found';
    console.error(errorMsg);
    alert(errorMsg);
    throw new Error(errorMsg);
  }

  if (typeof videoTransceiver.setCodecPreferences === 'function') {
    // Modern API: use setCodecPreferences with only the selected codec
    const codecName = selectedCodec.mimeType.split('/')[1];
    console.log(`Setting codec preference to ${codecName}`);

    try {
      videoTransceiver.setCodecPreferences([selectedCodec]);
      console.log(`✓ Codec preference set to ${selectedCodec.mimeType}`);
    } catch (e) {
      const errorMsg = `ERROR: Failed to set codec preference: ${e.message}`;
      console.error(errorMsg);
      alert(errorMsg);
      throw e;
    }
  } else {
    const errorMsg = 'ERROR: setCodecPreferences API not supported in this browser';
    console.error(errorMsg);
    alert(errorMsg);
    throw new Error(errorMsg);
  }
}

function verifyNegotiatedCodec() {
  const transceivers = pc1.getTransceivers();
  const videoTransceiver = transceivers.find(t => t.sender.track?.kind === 'video');

  if (!videoTransceiver) {
    console.error('No video transceiver found for verification');
    return;
  }

  const params = videoTransceiver.sender.getParameters();
  if (params.codecs && params.codecs.length > 0) {
    const negotiatedCodec = params.codecs[0];
    const selectedMimeType = selectedCodec.mimeType.toLowerCase();
    const negotiatedMimeType = negotiatedCodec.mimeType.toLowerCase();

    console.log('Negotiated codec:', negotiatedCodec);
    console.log('Selected codec:', selectedCodec);

    if (negotiatedMimeType !== selectedMimeType) {
      const errorMsg = `ERROR: Codec mismatch! Expected ${selectedCodec.mimeType} but got ${negotiatedCodec.mimeType}`;
      console.error(errorMsg);
      alert(errorMsg);
      hangup();
      throw new Error(errorMsg);
    }

    // Check if there are fallback codecs (there should be only one)
    if (params.codecs.length > 1) {
      const errorMsg = `ERROR: Multiple codecs negotiated (${params.codecs.length}). Expected only ${selectedCodec.mimeType}.`;
      console.error(errorMsg);
      alert(errorMsg);
      hangup();
      throw new Error(errorMsg);
    }

    negotiatedCodecName = (negotiatedCodec.mimeType.split('/')[1] || '').toUpperCase();
    console.log(`✓ Codec ${negotiatedCodec.mimeType} successfully negotiated (only codec)`);
  } else {
    console.warn('No codec information available in sender parameters');
  }
}

// query getStats every second
window.setInterval(() => {
  if (!pc1) {
    return;
  }

  const sender = pc1.getSenders()[0];
  if (!sender) {
    return;
  }

  sender.getStats().then(res => {
    res.forEach(report => {
      if (report.isRemote) {
        return;
      }

      if (report.type !== 'outbound-rtp') {
        return;
      }

      const previousReport = lastResult?.get(report.id)
      if (!previousReport) {
        return;
      }

      const now = report.timestamp;
      const bytesSent = report.bytesSent;
      const headerBytes = report.headerBytesSent;
      const packets = report.packetsSent;

      // calculate bitrate
      const bitrate = 8 * (bytesSent - previousReport.bytesSent) /
        (now - previousReport.timestamp) * 1000;
      const headerrate = 8 * (headerBytes - previousReport.headerBytesSent) /
        (now - previousReport.timestamp) * 1000;

      // append to chart
      bitrateSeries.addPoint(now, bitrate);
      headerrateSeries.addPoint(now, headerrate);
      bitrateGraph.setDataSeries([bitrateSeries, headerrateSeries]);
      bitrateGraph.updateEndDate();

      // calculate number of packets and append to chart
      const packetsPerSecond = packets - previousReport.packetsSent;

      packetSeries.addPoint(now, packetsPerSecond);
      packetGraph.setDataSeries([packetSeries]);
      packetGraph.updateEndDate();

      // update text values
      document.getElementById('bitrateValue').innerText = Math.ceil(bitrate);
      document.getElementById('packetValue').innerText = packetsPerSecond;

      // accumulators for CSV
      bitrateMax = Math.max(bitrateMax, bitrate);
      bitrateSum += bitrate;
      bitrateSamples += 1;
      ppsMax = Math.max(ppsMax, packetsPerSecond);
      ppsSum += packetsPerSecond;

      updateCsvRow();
    });

    lastResult = res;
  });
}, 1000);

function updateCsvRow() {
  const csvEl = document.getElementById('csvLine');
  if (!csvEl) return;

  // Determine codec name
  let codecName = negotiatedCodecName;
  if (!codecName && selectedCodec) {
    codecName = (selectedCodec.mimeType.split('/')[1] || '').toUpperCase();
  }

  // Determine current settings
  let w = Number(width.value) || 0;
  let h = Number(height.value) || 0;
  let fps = Number(frameRate.value) || '';
  try {
    const s = pc1 && pc1.getSenders && pc1.getSenders()[0];
    const settings = s && s.track && s.track.getSettings ? s.track.getSettings() : {};
    if (settings) {
      w = settings.width || w || localVideo.videoWidth || 0;
      h = settings.height || h || localVideo.videoHeight || 0;
      if (settings.frameRate) fps = Math.round(settings.frameRate);
    }
  } catch (e) {
    // ignore
  }

  const avgBitrate = bitrateSamples ? Math.round(bitrateSum / bitrateSamples) : '';
  const maxBitrate = bitrateMax ? Math.round(bitrateMax) : '';
  const avgPps = bitrateSamples ? Math.round(ppsSum / bitrateSamples) : '';
  const maxPps = ppsMax ? Math.round(ppsMax) : '';

  const row = [
    codecName || '',
    w || '',
    h || '',
    fps || '',
    maxBitrate || '',
    avgBitrate || '',
    maxPps || '',
    avgPps || ''
  ].join(',');

  csvEl.textContent = row;
}

// Return a number between 0 and maxValue based on the input number,
// so that the output changes smoothly up and down.
function triangle(number, maxValue) {
  const modulus = (maxValue + 1) * 2;
  return Math.abs(number % modulus - maxValue);
}

function syntheticVideoStream({frameRate, width = 640, height = 480, signal} = {}) {
  const canvas = Object.assign(
      document.createElement('canvas'), {width, height}
  );
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(frameRate);

  let count = 0;
  setInterval(() => {
    // Use relatively-prime multipliers to get a color roll
    const r = triangle(count*2, 255);
    const g = triangle(count*3, 255);
    const b = triangle(count*5, 255);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    count += 1;
    const boxSize=80;
    ctx.fillRect(0, 0, width, height);

    // Add some bouncing boxes in contrast color to add a little more noise.
    const rContrast = (r + 128)%256;
    const gContrast = (g + 128)%256;
    const bContrast = (b + 128)%256;
    ctx.fillStyle = `rgb(${rContrast}, ${gContrast}, ${bContrast})`;
    const xpos = triangle(count*5, width - boxSize);
    const ypos = triangle(count*7, height - boxSize);
    ctx.fillRect(xpos, ypos, boxSize, boxSize);
    const xpos2 = triangle(count*11, width - boxSize);
    const ypos2 = triangle(count*13, height - boxSize);
    ctx.fillRect(xpos2, ypos2, boxSize, boxSize);

    // If signal is set (0-255), add a constant-color box of that luminance to
    // the video frame at coordinates 20 to 60 in both X and Y direction.
    // (big enough to avoid color bleed from surrounding video in some codecs,
    // for more stable tests).
    if (signal != undefined) {
      ctx.fillStyle = `rgb(${signal}, ${signal}, ${signal})`;
      ctx.fillRect(20, 20, 40, 40);
    }
  }, 100);
  return stream;
}

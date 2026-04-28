#!/usr/bin/env node
/**
 * Generates an HTML page with an interactive bitrate chart (avg and max) vs
 * resolution grouped by codec. avg_bps and max_bps for the same codec share
 * color (solid line for avg, dashed line for max).
 */

import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

// Read and parse CSV
let records;
try {
  const csvContent = readFileSync('stats.csv', 'utf-8');
  records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
    comment: '#'
  });
} catch (err) {
  console.error("Error: Could not find stats.csv");
  process.exit(1);
}

// Filter valid records
records = records.filter(r => r.codec && r.width && r.height && r.avg_bps);

// Create resolution labels and sort by pixel count
records.forEach(r => {
  r.resolution = `${r.width}x${r.height}`;
  r.total_pixels = r.width * r.height;
});

// Group by codec
const codecs = [...new Set(records.map(r => r.codec))];
const colors = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
];

// Get all unique resolutions in order
const allResolutions = [...new Set(records.map(r => r.resolution))];
const sortedResolutions = allResolutions.sort((a, b) => {
  const [w1, h1] = a.split('x').map(Number);
  const [w2, h2] = b.split('x').map(Number);
  return (w1 * h1) - (w2 * h2);
});

// Prepare datasets
const datasets = [];

codecs.forEach((codec, idx) => {
  const codecData = records
    .filter(r => r.codec === codec)
    .sort((a, b) => a.total_pixels - b.total_pixels);

  const color = colors[idx % colors.length];

  // Build resolution-to-values map
  const dataMap = {};
  codecData.forEach(r => {
    dataMap[r.resolution] = r;
  });

  // Dataset for avg_bps (solid line)
  datasets.push({
    label: `${codec} (avg)`,
    data: sortedResolutions.map(res => dataMap[res] ? dataMap[res].avg_bps / 1_000 : null),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 4,
    borderDash: [],
    fill: false,
    spanGaps: true
  });

  // Dataset for max_bps (dashed line)
  if (codecData.some(r => r.max_bps)) {
    datasets.push({
      label: `${codec} (max)`,
      data: sortedResolutions.map(res => dataMap[res]?.max_bps ? dataMap[res].max_bps / 1_000 : null),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 1.5,
      pointRadius: 3,
      pointStyle: 'rect',
      borderDash: [5, 5],
      fill: false,
      spanGaps: true
    });
  }
});

// Generate HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bitrate by Resolution and Codec</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      text-align: center;
      color: #333;
    }
    #chartContainer {
      position: relative;
      height: 600px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Average and Peak Bitrate by Resolution and Codec</h1>
    <div id="chartContainer">
      <canvas id="bitrateChart"></canvas>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('bitrateChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(sortedResolutions)},
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: { font: { size: 11 } }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Resolution',
              font: { size: 14 }
            },
            ticks: {
              autoSkip: false,
              maxRotation: 45,
              minRotation: 45
            }
          },
          y: {
            title: {
              display: true,
              text: 'Bitrate (kbps)',
              font: { size: 14 }
            },
            beginAtZero: true
          }
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false
        }
      }
    });
  </script>
</body>
</html>`;

const outputFile = 'bitrate_chart.html';
writeFileSync(outputFile, html);

console.log(`✓ Chart saved to: ${outputFile}`);
console.log("  Open this file in your browser to view the interactive chart.");

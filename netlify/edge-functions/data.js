// netlify/edge-functions/data.js
import fs from 'fs';
import fetch from 'node-fetch';

// —— Exported function to generate the dashboard payload ——
export async function buildDashboardData() {
  const SYMBOL = "BTCUSDT";
  const LIMIT  = 250;
  const result = {
    dataA: {}, dataB: null, dataC: {}, dataD: {}, dataE: null,
    dataF: null, dataG: null, dataH: null, errors: []
  };

  /* helpers */
  const safeJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const sma = (arr, p) =>
    arr.slice(-p).reduce((sum, x) => sum + x, 0) / p;
  const ema = (arr, p) => {
    if (arr.length < p) return 0;
    const k = 2/(p+1);
    let val = sma(arr.slice(0,p), p);
    for (let i = p; i < arr.length; i++) {
      val = arr[i] * k + val * (1 - k);
    }
    return val;
  };
  const rsi = (arr, p) => {
    if (arr.length < p+1) return 0;
    let up=0, down=0;
    for (let i = 1; i <= p; i++) {
      const d = arr[i] - arr[i-1];
      if (d >= 0) up += d; else down -= d;
    }
    let avgU = up/p, avgD = down/p;
    for (let i = p+1; i < arr.length; i++) {
      const d = arr[i] - arr[i-1];
      avgU = (avgU*(p-1) + Math.max(d,0)) / p;
      avgD = (avgD*(p-1) + Math.max(-d,0)) / p;
    }
    return avgD ? 100 - 100/(1 + avgU/avgD) : 100;
  };
  const atr = (H,L,C,p) => {
    if (H.length < p+1) return 0;
    const tr = [];
    for (let i = 1; i < H.length; i++) {
      tr.push(Math

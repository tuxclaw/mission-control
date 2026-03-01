import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemStats, SystemHistoryPoint, SystemGpuHistoryPoint } from '../types';

type HistoryPeriod = '1h' | '24h';

type UsageClass = 'sysdash-usage-low' | 'sysdash-usage-mid' | 'sysdash-usage-high' | 'sysdash-usage-crit';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function usageColor(pct: number) {
  if (pct < 50) return 'var(--green)';
  if (pct < 75) return 'var(--yellow)';
  if (pct < 90) return 'var(--accent)';
  return 'var(--red)';
}

function usageClass(pct: number): UsageClass {
  if (pct < 50) return 'sysdash-usage-low';
  if (pct < 75) return 'sysdash-usage-mid';
  if (pct < 90) return 'sysdash-usage-high';
  return 'sysdash-usage-crit';
}

function tempClass(pct: number): UsageClass {
  if (pct < 50) return 'sysdash-usage-low';
  if (pct < 70) return 'sysdash-usage-mid';
  if (pct < 85) return 'sysdash-usage-high';
  return 'sysdash-usage-crit';
}

function coreColor(pct: number) {
  if (pct < 20) return 'rgba(0, 212, 255, 0.3)';
  if (pct < 40) return 'rgba(0, 230, 118, 0.4)';
  if (pct < 60) return 'rgba(0, 230, 118, 0.6)';
  if (pct < 75) return 'rgba(234, 179, 8, 0.6)';
  if (pct < 90) return 'rgba(239, 68, 68, 0.6)';
  return 'rgba(255, 82, 82, 0.8)';
}

function drawChart(
  canvas: HTMLCanvasElement | null,
  data: Array<SystemHistoryPoint | SystemGpuHistoryPoint>,
  valueKey: 'cpu_total' | 'mem_percent' | 'busy',
  color: string,
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 16, bottom: 30, left: 48 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) {
    ctx.fillStyle = '#8b8fa1';
    ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Collecting data...', w / 2, h / 2);
    return;
  }

  const values = data.map((d) => (d as Record<string, number>)[valueKey] ?? 0);
  const maxVal = 100;
  const minVal = 0;
  const timeMin = data[0]?.timestamp ?? 0;
  const timeMax = data[data.length - 1]?.timestamp ?? timeMin + 1;
  const timeRange = timeMax - timeMin || 1;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = '#8b8fa1';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${100 - i * 25}%`, pad.left - 8, y + 4);
  }

  ctx.fillStyle = '#8b8fa1';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  const numLabels = Math.min(6, data.length);
  for (let i = 0; i < numLabels; i += 1) {
    const idx = Math.floor((i / (numLabels - 1)) * (data.length - 1));
    const x = pad.left + (plotW * i) / (numLabels - 1);
    const date = new Date(data[idx]?.timestamp ?? 0);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(timeStr, x, h - 8);
  }

  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + plotH);
  for (let i = 0; i < data.length; i += 1) {
    const x = pad.left + (((data[i]?.timestamp ?? timeMin) - timeMin) / timeRange) * plotW;
    const y = pad.top + plotH - ((values[i] - minVal) / (maxVal - minVal)) * plotH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  gradient.addColorStop(0, `${color}40`);
  gradient.addColorStop(1, `${color}05`);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < data.length; i += 1) {
    const x = pad.left + (((data[i]?.timestamp ?? timeMin) - timeMin) / timeRange) * plotW;
    const y = pad.top + plotH - ((values[i] - minVal) / (maxVal - minVal)) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const last = data[data.length - 1] as Record<string, number> | undefined;
  if (last) {
    const x = pad.left + plotW;
    const y = pad.top + plotH - (((last[valueKey] ?? 0) - minVal) / (maxVal - minVal)) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = `${color}60`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

export function SystemDash() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [cpuPeriod, setCpuPeriod] = useState<HistoryPeriod>('1h');
  const [memPeriod, setMemPeriod] = useState<HistoryPeriod>('1h');
  const [gpuPeriod, setGpuPeriod] = useState<HistoryPeriod>('1h');
  const [cpuHistory, setCpuHistory] = useState<SystemHistoryPoint[]>([]);
  const [memHistory, setMemHistory] = useState<SystemHistoryPoint[]>([]);
  const [gpuHistory, setGpuHistory] = useState<SystemGpuHistoryPoint[]>([]);

  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const memCanvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);

  const colors = useMemo(() => ({
    cpu: '#06b6d4',
    mem: '#a855f7',
    gpu: '#22c55e',
  }), []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let alive = true;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws/system`);

      ws.onopen = () => {
        if (!alive) return;
        setConnected(true);
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SystemStats;
          setStats(data);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        reconnectTimer = window.setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const refreshHistory = useCallback(async () => {
    const [cpuData, memData, gpuData] = await Promise.all([
      fetch(`/api/system/history/${cpuPeriod}`).then((res) => res.json()).catch(() => []),
      fetch(`/api/system/history/${memPeriod}`).then((res) => res.json()).catch(() => []),
      fetch(`/api/system/gpu-history/${gpuPeriod}`).then((res) => res.json()).catch(() => []),
    ]);
    setCpuHistory(cpuData as SystemHistoryPoint[]);
    setMemHistory(memData as SystemHistoryPoint[]);
    setGpuHistory(gpuData as SystemGpuHistoryPoint[]);
  }, [cpuPeriod, memPeriod, gpuPeriod]);

  useEffect(() => {
    refreshHistory();
    const timer = window.setInterval(refreshHistory, 30000);
    return () => window.clearInterval(timer);
  }, [refreshHistory]);

  useEffect(() => {
    drawChart(cpuCanvasRef.current, cpuHistory, 'cpu_total', colors.cpu);
  }, [cpuHistory, colors.cpu]);

  useEffect(() => {
    drawChart(memCanvasRef.current, memHistory, 'mem_percent', colors.mem);
  }, [memHistory, colors.mem]);

  useEffect(() => {
    drawChart(gpuCanvasRef.current, gpuHistory, 'busy', colors.gpu);
  }, [gpuHistory, colors.gpu]);

  useEffect(() => {
    const handleResize = () => {
      drawChart(cpuCanvasRef.current, cpuHistory, 'cpu_total', colors.cpu);
      drawChart(memCanvasRef.current, memHistory, 'mem_percent', colors.mem);
      drawChart(gpuCanvasRef.current, gpuHistory, 'busy', colors.gpu);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [cpuHistory, memHistory, gpuHistory, colors]);

  const cpu = stats?.cpu;
  const memory = stats?.memory;
  const disks = stats?.disk ?? [];
  const gpus = stats?.gpus ?? [];
  const processes = stats?.processes ?? [];
  const containers = stats?.containers ?? [];
  const loadAvg = stats?.loadAvg;

  return (
    <section className="sysdash" aria-label="System dashboard">
      <header className="sysdash__header">
        <div className="sysdash__identity">
          <h1 className="sysdash__title">System</h1>
          <div className="sysdash__meta">
            <span className="sysdash__hostname">{stats?.hostname ?? '—'}</span>
            <span className="sysdash__uptime">{stats?.uptime?.formatted ?? 'Uptime: —'}</span>
            <span className={`sysdash__status ${connected ? 'sysdash__status--ok' : 'sysdash__status--down'}`}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="sysdash__cpu-model">{stats?.cpuModel ?? 'CPU model unknown'}</div>
      </header>

      <div className="sysdash__top-row">
        <div className="sysdash-card sysdash-cpu">
          <div className="sysdash-card__header">
            <h2>CPU</h2>
            <span className="sysdash-card__sub">Load: {loadAvg ? `${loadAvg['1m']} / ${loadAvg['5m']} / ${loadAvg['15m']}` : '—'}</span>
          </div>
          <div className="sysdash-cpu__summary">
            <div className={`sysdash-big ${cpu ? usageClass(cpu.total) : ''}`}>{cpu ? `${cpu.total}%` : '—'}</div>
            <div className="sysdash-cpu__cores" aria-label="CPU core heatmap">
              {(cpu?.cores ?? []).map((core) => (
                <div
                  key={core.core}
                  className="sysdash-cpu__core"
                  style={{ backgroundColor: coreColor(core.usage) }}
                  title={`Core ${core.core}: ${core.usage}%`}
                >
                  {core.core}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sysdash-card sysdash-memory">
          <div className="sysdash-card__header">
            <h2>Memory</h2>
          </div>
          <div className="sysdash-memory__summary">
            <div className={`sysdash-big ${memory ? usageClass(memory.percent) : ''}`}>{memory ? `${memory.percent}%` : '—'}</div>
            <div className="sysdash-gauge">
              <div
                className="sysdash-gauge__bar"
                style={{
                  width: `${memory?.percent ?? 0}%`,
                  background: `linear-gradient(90deg, ${usageColor(memory?.percent ?? 0)}, ${usageColor(Math.min(100, (memory?.percent ?? 0) + 20))})`,
                }}
              />
            </div>
            <div className="sysdash-memory__details">
              <span>Used: {memory ? formatBytes(memory.used) : '—'}</span>
              <span>Free: {memory ? formatBytes(memory.free) : '—'}</span>
              <span>Total: {memory ? formatBytes(memory.total) : '—'}</span>
            </div>
          </div>
        </div>

        <div className="sysdash-card sysdash-disk">
          <div className="sysdash-card__header">
            <h2>Disk</h2>
          </div>
          <div className="sysdash-disk__list">
            {disks.length === 0 && <div className="sysdash-empty">No disk data</div>}
            {disks.map((disk) => (
              <div key={disk.mount} className="sysdash-disk__item">
                <div className="sysdash-disk__header">
                  <span className="sysdash-disk__mount">{disk.mount}</span>
                  <span className="sysdash-disk__usage">
                    {formatBytes(disk.used)} / {formatBytes(disk.total)} ({disk.percent}%)
                  </span>
                </div>
                <div className="sysdash-disk__bar-wrap">
                  <div
                    className="sysdash-disk__bar"
                    style={{
                      width: `${disk.percent}%`,
                      background: usageColor(disk.percent),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sysdash__gpu">
        {gpus.length === 0 && (
          <div className="sysdash-card sysdash-empty">No discrete GPU detected</div>
        )}
        {gpus.map((gpu, index) => (
          <div key={gpu.card} className="sysdash-card sysdash-gpu">
            <div className="sysdash-card__header">
              <div>
                <h2>GPU{gpus.length > 1 ? ` ${index + 1}` : ''}</h2>
                <span className="sysdash-card__sub">{gpu.model ?? 'Unknown model'}</span>
              </div>
              <div className={`sysdash-big ${usageClass(gpu.busy)}`}>{gpu.busy}%</div>
            </div>
            <div className="sysdash-gpu__vram">
              <div className="sysdash-gpu__vram-label">
                <span>VRAM</span>
                <span>{formatBytes(gpu.vramUsed)} / {formatBytes(gpu.vramTotal)} ({gpu.vramPercent}%)</span>
              </div>
              <div className="sysdash-gauge">
                <div
                  className="sysdash-gauge__bar"
                  style={{
                    width: `${gpu.vramPercent}%`,
                    background: `linear-gradient(90deg, ${usageColor(gpu.vramPercent)}, ${usageColor(Math.min(100, gpu.vramPercent + 20))})`,
                  }}
                />
              </div>
            </div>
            <div className="sysdash-gpu__stats">
              {gpu.tempEdge !== null && (
                <div className="sysdash-gpu__stat">
                  <span>Edge</span>
                  <span className={tempClass(gpu.tempEdge)}>{gpu.tempEdge}°C</span>
                </div>
              )}
              {gpu.tempJunction !== null && (
                <div className="sysdash-gpu__stat">
                  <span>Junction</span>
                  <span className={tempClass(gpu.tempJunction)}>{gpu.tempJunction}°C</span>
                </div>
              )}
              {gpu.tempMem !== null && (
                <div className="sysdash-gpu__stat">
                  <span>Memory</span>
                  <span className={tempClass(gpu.tempMem)}>{gpu.tempMem}°C</span>
                </div>
              )}
              {gpu.powerW !== null && (
                <div className="sysdash-gpu__stat">
                  <span>Power</span>
                  <span>{gpu.powerW}W / {gpu.powerCapW ?? 0}W</span>
                </div>
              )}
              {gpu.fanRpm !== null && (
                <div className="sysdash-gpu__stat">
                  <span>Fan</span>
                  <span>{gpu.fanRpm} RPM</span>
                </div>
              )}
              {gpu.sclkMhz > 0 && (
                <div className="sysdash-gpu__stat">
                  <span>Core</span>
                  <span>{gpu.sclkMhz} MHz</span>
                </div>
              )}
              {gpu.mclkMhz > 0 && (
                <div className="sysdash-gpu__stat">
                  <span>Mem Clk</span>
                  <span>{gpu.mclkMhz} MHz</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sysdash__charts">
        <div className="sysdash-card sysdash-chart">
          <div className="sysdash-card__header sysdash-card__header--tight">
            <h3>CPU History</h3>
            <div className="sysdash-chart__controls">
              {(['1h', '24h'] as HistoryPeriod[]).map((period) => (
                <button
                  key={period}
                  type="button"
                  className={`sysdash-chart__btn ${cpuPeriod === period ? 'sysdash-chart__btn--active' : ''}`}
                  onClick={() => setCpuPeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <canvas ref={cpuCanvasRef} className="sysdash-chart__canvas" aria-label="CPU history chart" />
        </div>

        <div className="sysdash-card sysdash-chart">
          <div className="sysdash-card__header sysdash-card__header--tight">
            <h3>Memory History</h3>
            <div className="sysdash-chart__controls">
              {(['1h', '24h'] as HistoryPeriod[]).map((period) => (
                <button
                  key={period}
                  type="button"
                  className={`sysdash-chart__btn ${memPeriod === period ? 'sysdash-chart__btn--active' : ''}`}
                  onClick={() => setMemPeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <canvas ref={memCanvasRef} className="sysdash-chart__canvas" aria-label="Memory history chart" />
        </div>

        <div className="sysdash-card sysdash-chart sysdash-chart--wide">
          <div className="sysdash-card__header sysdash-card__header--tight">
            <h3>GPU History</h3>
            <div className="sysdash-chart__controls">
              {(['1h', '24h'] as HistoryPeriod[]).map((period) => (
                <button
                  key={period}
                  type="button"
                  className={`sysdash-chart__btn ${gpuPeriod === period ? 'sysdash-chart__btn--active' : ''}`}
                  onClick={() => setGpuPeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <canvas ref={gpuCanvasRef} className="sysdash-chart__canvas" aria-label="GPU history chart" />
        </div>
      </div>

      <div className="sysdash__bottom-row">
        <div className="sysdash-card sysdash-processes">
          <div className="sysdash-card__header">
            <h2>Top Processes</h2>
          </div>
          <div className="sysdash-table-wrap">
            <table className="sysdash-table">
              <thead>
                <tr>
                  <th>PID</th>
                  <th>User</th>
                  <th>CPU%</th>
                  <th>MEM%</th>
                  <th>Command</th>
                </tr>
              </thead>
              <tbody>
                {processes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="sysdash-empty">No process data</td>
                  </tr>
                )}
                {processes.map((proc) => (
                  <tr key={proc.pid}>
                    <td>{proc.pid}</td>
                    <td>{proc.user}</td>
                    <td className={usageClass(proc.cpu)}>{proc.cpu.toFixed(1)}</td>
                    <td className={usageClass(proc.mem)}>{proc.mem.toFixed(1)}</td>
                    <td title={proc.command}>{proc.command}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sysdash-card sysdash-containers">
          <div className="sysdash-card__header">
            <h2>Containers</h2>
            <span className="sysdash-card__sub">{containers.length} running</span>
          </div>
          <div className="sysdash-containers__list">
            {containers.length === 0 && (
              <div className="sysdash-empty">No containers running</div>
            )}
            {containers.map((container) => {
              const state = (container.state || container.status || '').toLowerCase();
              const stateClass = state.includes('run')
                ? 'sysdash-container__state--running'
                : state.includes('exit')
                  ? 'sysdash-container__state--exited'
                  : 'sysdash-container__state--paused';
              return (
                <div key={container.id} className="sysdash-container">
                  <span className={`sysdash-container__state ${stateClass}`} />
                  <div className="sysdash-container__info">
                    <div className="sysdash-container__name">{container.name}</div>
                    <div className="sysdash-container__image">{container.image}</div>
                  </div>
                  <div className="sysdash-container__id">{container.id}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// CargaExpress GV — Load Test (sin Artillery)
// Uso: node tests/load/run.mjs
// Mide latencia, errores, throughput contra Railway

const BASE = process.env.API_URL || 'https://zippy-trust-production.up.railway.app'
const USERS = [100, 500, 1000]
const ENDPOINTS = {
  health: { method: 'GET', path: '/health' },
  metrics: { method: 'GET', path: '/metrics' },
}

async function bench(endpoint, concurrency, durationSec = 10) {
  const { method, path } = endpoint
  const url = `${BASE}${path}`
  const latencies = []
  let errors = 0
  let completed = 0
  const start = Date.now()
  const deadline = start + durationSec * 1000

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = Date.now()
      try {
        const res = await fetch(url, { method, signal: AbortSignal.timeout(5000) })
        const elapsed = Date.now() - t0
        latencies.push(elapsed)
        completed++
        if (!res.ok) errors++
      } catch {
        errors++
        completed++
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  const elapsed = (Date.now() - start) / 1000

  latencies.sort((a, b) => a - b)
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)
  const rps = Math.round(completed / elapsed)

  return {
    concurrency,
    duration: elapsed.toFixed(1),
    completed,
    errors,
    errorRate: ((errors / completed) * 100).toFixed(2) + '%',
    rps,
    latencies: { avg: avg.toFixed(0), p50, p95, p99 },
  }
}

async function main() {
  console.log(`\n╔══════════════════════════════════════════════╗`)
  console.log(`║  CargaExpress GV — Load Test                ║`)
  console.log(`║  Target: ${BASE}`)
  console.log(`╚══════════════════════════════════════════════╝\n`)

  for (const users of USERS) {
    console.log(`\n━━━ Test: ${users} usuarios concurrentes ━━━`)
    const result = await bench(ENDPOINTS.health, users, 10)
    console.log(`  Completados: ${result.completed} requests`)
    console.log(`  Errores:     ${result.errors} (${result.errorRate})`)
    console.log(`  Throughput:  ${result.rps} req/s`)
    console.log(`  Latencia:    avg=${result.latencies.avg}ms  p50=${result.latencies.p50}ms  p95=${result.latencies.p95}ms  p99=${result.latencies.p99}ms`)
  }

  // Test endpoints
  console.log(`\n━━━ Test: Endpoints varios (100 concurrentes) ━━━`)
  for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
    const result = await bench(endpoint, 100, 5)
    console.log(`  ${name}: avg=${result.latencies.avg}ms  p95=${result.latencies.p95}ms  ${result.rps} req/s  errors=${result.errorRate}`)
  }

  console.log(`\n✅ Load test completed\n`)
}

main().catch(console.error)

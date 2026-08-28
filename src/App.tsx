import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import BottomNav from './components/BottomNav'
import LoadingScreen from './components/LoadingScreen'
import { useFitbitData } from './hooks/useFitbitData'
import { useSync } from './hooks/useSync'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Recovery = lazy(() => import('./pages/Recovery'))
const Sleep = lazy(() => import('./pages/Sleep'))
const Strain = lazy(() => import('./pages/Strain'))
const Settings = lazy(() => import('./pages/Settings'))
const Health = lazy(() => import('./pages/Health'))
const AIAnalysis = lazy(() => import('./pages/AIAnalysis'))
const Treino = lazy(() => import('./pages/Treino'))
const Previsao = lazy(() => import('./pages/Previsao'))
const ConnectFitbit = lazy(() => import('./pages/ConnectFitbit'))

function UpdateBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing
        if (!sw) return
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            setShow(true)
          }
        })
      })
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    })
  }, [])

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-bhr-green text-black text-sm font-bold px-4 py-3 flex items-center justify-between safe-top">
      <span>Nova versão disponível!</span>
      <button
        onClick={async () => {
          const keys = await caches.keys()
          await Promise.all(keys.map(k => caches.delete(k)))
          const reg = await navigator.serviceWorker.getRegistration()
          reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
        }}
        className="bg-black text-bhr-green px-3 py-1 rounded-lg text-xs font-bold"
      >
        Atualizar
      </button>
    </div>
  )
}

function AppWithAutoSync() {
  const { syncStatus, refresh } = useFitbitData()
  const { sync } = useSync(refresh)

  useEffect(() => {
    const lastSync = syncStatus?.last_sync_at
    if (lastSync == null) {
      sync()
      return
    }
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000
    if (new Date(lastSync).getTime() < sixHoursAgo) {
      sync()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus?.last_sync_at])

  return (
    <div className="flex flex-col h-full bg-black text-white overflow-hidden">
      <UpdateBanner />
      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recuperacao" element={<Recovery />} />
          <Route path="/sono" element={<Sleep />} />
          <Route path="/esforco" element={<Strain />} />
          <Route path="/saude" element={<Health />} />
          <Route path="/ia" element={<AIAnalysis />} />
          <Route path="/treino" element={<Treino />} />
          <Route path="/previsao" element={<Previsao />} />
          <Route path="/configuracoes" element={<Settings />} />
          <Route path="/conectar-fitbit" element={<ConnectFitbit />} />
          <Route path="/conectar-whoop" element={<Navigate to="/conectar-fitbit" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </div>
      <BottomNav />
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingScreen />

  if (!user) {
    return (
      <BrowserRouter basename="/saude">
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter basename="/saude">
      <AppWithAutoSync />
    </BrowserRouter>
  )
}

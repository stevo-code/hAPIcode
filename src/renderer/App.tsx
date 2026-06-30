import { useEffect } from 'react'
import { useApp, type Section } from './store'
import { useT } from './lib/i18n'
import { Sidebar } from './components/Sidebar'
import { WindowControls } from './components/WindowControls'
import { IconMark, Wordmark } from './components/Logo'
import { ConversationView } from './components/ConversationView'
import { SettingsView } from './components/SettingsView'
import { BackgroundTasksPanel } from './components/BackgroundTasksPanel'
import { Resizer } from './components/Resizer'

export default function App(): JSX.Element {
  const t = useT()
  const view = useApp((s) => s.view)
  const bootstrap = useApp((s) => s.bootstrap)
  const credentials = useApp((s) => s.credentials)
  const setView = useApp((s) => s.setView)
  const newConversation = useApp((s) => s.newConversation)
  const activeChatId = useApp((s) => s.activeChatId)
  const activeCodeId = useApp((s) => s.activeCodeId)
  const showTasks = useApp((s) => s.showTasks)
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const setSidebarWidth = useApp((s) => s.setSidebarWidth)
  const setTasksWidth = useApp((s) => s.setTasksWidth)

  useEffect(() => {
    bootstrap()
  }, [])

  return (
    <div className="app">
      <Sidebar />
      {!collapsed && <Resizer onResize={(x) => setSidebarWidth(x)} />}
      <main className="main">
        {view === 'settings' ? (
          <SettingsView />
        ) : credentials.length === 0 ? (
          <div className="empty-card center">
            <div className="welcome-logo">
              <IconMark size={72} />
              <Wordmark />
            </div>
            <p>{t('welcomeText')}</p>
            <button className="primary-btn" onClick={() => setView('settings')}>
              {t('addApiKey')}
            </button>
          </div>
        ) : (
          <SectionPane section={view as Section} activeId={view === 'code' ? activeCodeId : activeChatId} onNew={newConversation} />
        )}
      </main>
      {showTasks && <Resizer onResize={(x) => setTasksWidth(window.innerWidth - x)} />}
      {showTasks && <BackgroundTasksPanel />}
      <WindowControls />
    </div>
  )
}

function SectionPane({
  section,
  activeId,
  onNew
}: {
  section: Section
  activeId: string | null
  onNew: (s: Section) => string
}): JSX.Element {
  const t = useT()
  if (activeId) return <ConversationView convId={activeId} />
  return (
    <div className="empty-card center">
      <div className="empty-emoji">{section === 'chat' ? '💬' : '</>'}</div>
      <h2>{section === 'chat' ? t('chatEmptyTitle') : t('codeEmptyTitle')}</h2>
      <p>{section === 'chat' ? t('chatEmptyText') : t('codeEmptyText')}</p>
      <button className="primary-btn" onClick={() => onNew(section)}>
        {section === 'code' ? t('startProjectCta') : t('newConversation')}
      </button>
    </div>
  )
}

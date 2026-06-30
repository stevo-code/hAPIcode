import { useApp, type Section } from '../store'
import { useT } from '../lib/i18n'
import { IconMark, Wordmark } from './Logo'

/** Lien de don PayPal — ouvert dans le navigateur, aucun paiement dans l'app. */
const DONATE_URL = 'https://www.paypal.com/ncp/payment/YXJ63CAEPVDGG'

export function Sidebar(): JSX.Element {
  const t = useT()
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const newConversation = useApp((s) => s.newConversation)
  const selectConversation = useApp((s) => s.selectConversation)
  const deleteConversation = useApp((s) => s.deleteConversation)
  const conversations = useApp((s) => s.conversations)
  const activeChatId = useApp((s) => s.activeChatId)
  const activeCodeId = useApp((s) => s.activeCodeId)
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const width = useApp((s) => s.sidebarWidth)
  const searchOpen = useApp((s) => s.searchOpen)
  const searchQuery = useApp((s) => s.searchQuery)
  const setSearchOpen = useApp((s) => s.setSearchOpen)
  const setSearchQuery = useApp((s) => s.setSearchQuery)
  const update = useApp((s) => s.update)
  const dismissUpdate = useApp((s) => s.dismissUpdate)

  if (collapsed) {
    return (
      <nav className="sidebar collapsed">
        <div className="toolbar">
          <button className="tb-icon" onClick={toggleSidebar} title={t('options')}>
            ☰
          </button>
        </div>
      </nav>
    )
  }

  const section: Section = view === 'code' ? 'code' : 'chat'
  const activeId = section === 'chat' ? activeChatId : activeCodeId
  const q = searchQuery.trim().toLowerCase()

  const list = Object.values(conversations)
    .filter((c) => c.section === section && !c.archived)
    .filter((c) => !q || c.title.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <nav className="sidebar" style={{ width }}>
      <div className="sidebar-brand">
        <IconMark size={22} />
        <Wordmark />
      </div>
      <div className="toolbar">
        <button className="tb-icon" onClick={toggleSidebar} title={t('collapseSidebar')}>
          ☰
        </button>
        <button className={`tb-icon ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen(!searchOpen)} title="Rechercher">
          🔍
        </button>
        <span className="tb-spacer" />
      </div>

      {searchOpen && (
        <input
          className="sidebar-search"
          autoFocus
          placeholder={`${t('recents')}…`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
        />
      )}

      <div className="segmented">
        <button className={`seg-btn ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
          💬 {t('chat')}
        </button>
        <button className={`seg-btn ${view === 'code' ? 'active' : ''}`} onClick={() => setView('code')}>
          <span className="code-glyph">{'</>'}</span> {t('code')}
        </button>
      </div>

      <button className="new-conv" onClick={() => newConversation(section)}>
        {section === 'code' ? t('newProject') : t('newConversation')}
      </button>

      <div className="recents-head">{t('recents')}</div>
      <div className="recents">
        {list.length === 0 && <div className="recents-empty">{t('noConversation')}</div>}
        {list.map((c) => (
          <div
            key={c.id}
            className={`conv-item ${activeId === c.id && view !== 'settings' ? 'active' : ''}`}
            onClick={() => selectConversation(c.id)}
            title={c.title}
          >
            <span className="conv-dot" style={{ background: c.busy ? 'var(--accent)' : c.color }} />
            <span className="conv-title-txt">{c.title}</span>
            <button
              className="conv-del"
              title={t('delete')}
              onClick={(e) => {
                e.stopPropagation()
                deleteConversation(c.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        {update && (
          <div
            className="update-bubble"
            onClick={() => window.api.app.openExternal(update.url)}
            title={t('updateRelaunchHint')}
          >
            <IconMark size={18} />
            <div className="update-text">
              <span className="update-title">{t('updateAvailable')}</span>
              {update.latest && <span className="update-ver">v{update.latest}</span>}
            </div>
            <span className="update-arrow">→</span>
            <button
              className="update-x"
              title="✕"
              onClick={(e) => {
                e.stopPropagation()
                dismissUpdate()
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div className="foot-row">
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <span className="nav-icon">⚙</span>
            <span>{t('settings')}</span>
          </button>
          <button className="donate-btn" onClick={() => window.api.app.openExternal(DONATE_URL)} title={t('donateHint')}>
            <span className="donate-heart">💙</span>
            <span>{t('donate')}</span>
          </button>
        </div>
      </div>
    </nav>
  )
}

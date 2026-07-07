import { useApp } from '../store'
import { useT } from '../lib/i18n'

/** Carte Réglages : liste + édition des skills (instructions réutilisables auto-appliquées). */
export function SkillsCard(): JSX.Element {
  const t = useT()
  const skills = useApp((s) => s.skills)
  const addSkill = useApp((s) => s.addSkill)
  const updateSkill = useApp((s) => s.updateSkill)
  const removeSkill = useApp((s) => s.removeSkill)

  return (
    <section className="card">
      <h2>{t('skills')}</h2>
      <p className="muted small">{t('skillsDesc')}</p>

      {skills.length === 0 ? (
        <p className="muted">{t('noSkills')}</p>
      ) : (
        <ul className="skill-list">
          {skills.map((sk) => (
            <li key={sk.id} className="skill-item">
              <div className="skill-head">
                <input
                  className="skill-name"
                  type="text"
                  placeholder={t('skillNamePh')}
                  value={sk.name}
                  onChange={(e) => updateSkill(sk.id, { name: e.target.value })}
                />
                <label className="skill-active" title={t('skillActive')}>
                  <button
                    className={`switch ${sk.enabled ? 'on' : ''}`}
                    role="switch"
                    aria-checked={sk.enabled}
                    onClick={() => updateSkill(sk.id, { enabled: !sk.enabled })}
                  >
                    <span className="switch-knob" />
                  </button>
                </label>
                <button className="danger-btn small" onClick={() => removeSkill(sk.id)}>
                  {t('delete')}
                </button>
              </div>
              <label className="skill-field">
                {t('skillWhenLabel')}
                <input
                  type="text"
                  placeholder={t('skillWhenPh')}
                  value={sk.description}
                  onChange={(e) => updateSkill(sk.id, { description: e.target.value })}
                />
              </label>
              <label className="skill-field">
                {t('skillInstrLabel')}
                <textarea
                  rows={4}
                  placeholder={t('skillInstrPh')}
                  value={sk.instructions}
                  onChange={(e) => updateSkill(sk.id, { instructions: e.target.value })}
                />
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="form-actions">
        <button className="primary-btn" onClick={() => addSkill()}>
          {t('addSkill')}
        </button>
      </div>
    </section>
  )
}

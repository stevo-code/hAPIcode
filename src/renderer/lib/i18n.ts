import { translate, type TKey } from '@shared/i18n'
import { useApp } from '../store'

/** Hook de traduction : renvoie une fonction t(cle) selon la langue courante. */
export function useT(): (key: TKey) => string {
  const lang = useApp((s) => s.lang)
  return (key: TKey) => translate(lang, key)
}

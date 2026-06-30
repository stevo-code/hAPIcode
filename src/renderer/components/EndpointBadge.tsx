import { getPreset } from '@shared/providers'
import { useApp } from '../store'

function host(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Affiche le fournisseur + l'URL reellement appelee pour la cle selectionnee. */
export function EndpointBadge(): JSX.Element | null {
  const selected = useApp((s) => s.selected)
  const cred = useApp((s) => s.credentials.find((c) => c.id === selected?.credentialId))
  if (!cred) return null
  const name = getPreset(cred.providerId)?.name ?? cred.label
  return (
    <span className="endpoint-badge" title={`Requête envoyée à ${cred.baseUrl}`}>
      via {name} · {host(cred.baseUrl)}
    </span>
  )
}

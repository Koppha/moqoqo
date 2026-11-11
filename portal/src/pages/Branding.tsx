import { useState, type ChangeEvent } from 'react'
import { MINI_APP_ICONS, type Asset, type AssetKind, type Branding, type MiniAppIconId } from '../../../shared/api'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../components/Toast'
import { Card, ErrorState, Loading, PageHeader, ReadOnlyNotice, WriteButton } from '../components/ui'
import { assetUrl, uploadPicture } from '../upload'
import { useAsync } from '../useAsync'

/** The in-app logo (live at once), the home-screen icon (used by the next app build) and the mini app icons. */
export function BrandingPage() {
  const { canWrite } = useAuth()
  const toast = useToast()
  const current = useAsync(() => api.branding.get(), [])
  const [busy, setBusy] = useState<AssetKind | null>(null)

  const save = async (next: Branding) => {
    const saved = await api.branding.put({ logoId: next.logo?.id ?? null, appIconId: next.appIcon?.id ?? null })
    current.setData(() => saved)
  }

  const pick = (kind: 'logo' | 'app_icon') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !current.data) return
    setBusy(kind)
    try {
      const asset = await uploadPicture(file, kind)
      await save(kind === 'logo' ? { ...current.data, logo: asset } : { ...current.data, appIcon: asset })
      toast.success(kind === 'logo' ? 'Logo updated. The apps show it within a minute.' : 'Home-screen icon saved. It is used by the next app build.')
    } catch (err) {
      toast.error(err instanceof Error && !('status' in err) ? err.message : errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const reset = async (kind: 'logo' | 'app_icon') => {
    if (!current.data) return
    try {
      await save(kind === 'logo' ? { ...current.data, logo: null } : { ...current.data, appIcon: null })
      toast.success('Back to the built-in one.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <>
      <PageHeader title="Branding" subtitle="The logo inside the apps, the icon on the phone's home screen and the mini app icons. Service pictures are set on each service (Services)." />
      {!canWrite && <ReadOnlyNotice />}
      {current.error ? <ErrorState error={current.error} onRetry={current.reload} /> : !current.data ? <Loading /> : (
        <div className="grid-2">
          <BrandCard
            title="In-app logo"
            hint="Shown on Home, the sign-in screen, receipts and QR print-outs. Changes reach the apps at once. PNG or JPEG, at least 64 px; a wide logo on a transparent background works best."
            asset={current.data.logo}
            busy={busy === 'logo'}
            onPick={pick('logo')}
            onReset={() => reset('logo')}
          />
          <BrandCard
            title="Home-screen icon"
            hint="The icon people tap to open EcoCash Super App. Phones only change an app's icon with an app update, so this is used by the next build (run npm run fetch-branding before building). Square PNG, 1024 × 1024 is best (512 at least), with the artwork inside the middle 66%."
            asset={current.data.appIcon}
            busy={busy === 'app_icon'}
            onPick={pick('app_icon')}
            onReset={() => reset('app_icon')}
            square
          />
        </div>
      )}
      {current.data && <MiniAppIcons branding={current.data} onSaved={(b) => current.setData(() => b)} />}
    </>
  )
}

function BrandCard({ title, hint, asset, busy, onPick, onReset, square }: {
  title: string; hint: string; asset: Asset | null; busy: boolean; onPick: (e: ChangeEvent<HTMLInputElement>) => void; onReset: () => void; square?: boolean
}) {
  const { canWrite } = useAuth()
  const id = `pick-${title.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <Card title={title}>
      <p className="muted small">{hint}</p>
      <div className={`brand-preview ${square ? 'brand-preview-square' : ''}`}>
        {asset ? <img src={assetUrl(asset.path)} alt={`${title} preview`} /> : <span className="muted">Built-in</span>}
      </div>
      {asset && <p className="muted small">{asset.width} × {asset.height} px · {Math.round(asset.size / 1024)} KB</p>}
      <div className="row-gap">
        <label htmlFor={id} className={`btn btn-primary ${!canWrite || busy ? 'is-readonly' : ''}`} aria-disabled={!canWrite || busy}>
          {busy ? 'Uploading…' : 'Upload picture'}
        </label>
        <input id={id} type="file" accept="image/png,image/jpeg" className="sr-only" disabled={!canWrite || busy} onChange={onPick} />
        {asset && <WriteButton onClick={onReset}>Use built-in</WriteButton>}
      </div>
    </Card>
  )
}

/**
 * One icon per mini app: on its tile in EcoCash Super App (Home and Services) and inside the mini app, at once. A mini app that is
 * also its own app (EcoSure) uses the same icon on the phone's home screen from its next build.
 */
function MiniAppIcons({ branding, onSaved }: { branding: Branding; onSaved: (b: Branding) => void }) {
  const { canWrite } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState<MiniAppIconId | null>(null)

  const pick = (app: (typeof MINI_APP_ICONS)[number]) => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(app.id)
    try {
      const asset = await uploadPicture(file, 'app_icon')
      onSaved(await api.branding.miniAppIcon(app.id, { assetId: asset.id }))
      toast.success('standalone' in app
        ? `${app.name} icon saved. EcoCash Super App and the ${app.name} app show it within a minute; the ${app.name} home-screen icon changes with its next build.`
        : `${app.name} icon saved. The apps show it within a minute.`)
    } catch (err) {
      toast.error(err instanceof Error && !('status' in err) ? err.message : errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const reset = async (app: (typeof MINI_APP_ICONS)[number]) => {
    try {
      onSaved(await api.branding.miniAppIcon(app.id, { assetId: null }))
      toast.success(`${app.name} is back to its built-in icon.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card title="Mini app icons" icon="grid">
      <p className="muted small">
        The icon on each mini app's tile in EcoCash Super App (Home and Services) and inside the mini app. Square PNG, 1024 × 1024 is best (512 at least),
        artwork inside the middle 66%: tiles are cut to a circle. EcoSure is also its own app, so its icon is the EcoSure app's home-screen icon too,
        from the next EcoSure build (run npm run fetch-branding before building).
      </p>
      <ul className="miniapp-icons">
        {MINI_APP_ICONS.map((app) => {
          const asset = branding.miniAppIcons[app.id]
          const id = `pick-miniapp-${app.id}`
          return (
            <li key={app.id} className="miniapp-icon">
              <div className="miniapp-icon-preview">
                {asset ? <img src={assetUrl(asset.path)} alt={`${app.name} icon`} /> : <span className="muted small">Built-in</span>}
              </div>
              <div className="miniapp-icon-body">
                <span className="miniapp-icon-name">{app.name}</span>
                {'standalone' in app && <span className="chip chip-info">Also its own app</span>}
                {asset && <span className="muted small">{asset.width} × {asset.height} px</span>}
                <div className="row-gap">
                  <label htmlFor={id} className={`btn btn-secondary btn-sm ${!canWrite || busy ? 'is-readonly' : ''}`} aria-disabled={!canWrite || busy !== null}>
                    {busy === app.id ? 'Uploading…' : asset ? 'Replace' : 'Upload'}
                  </label>
                  <input id={id} type="file" accept="image/png" className="sr-only" disabled={!canWrite || busy !== null} onChange={pick(app)} />
                  {asset && <WriteButton size="sm" variant="ghost" onClick={() => reset(app)}>Use built-in</WriteButton>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

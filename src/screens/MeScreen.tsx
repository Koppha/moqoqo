import { router, usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import * as Application from 'expo-application'
import { Linking, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { CONTACT_DEFAULTS, USERNAME_PATTERN, type AppKind, type Me } from '../../shared/api'
import { api, ApiFailure } from '../lib/api'
import { Sheet, SheetOption } from '../components/Sheet'
import { Avatar, Button, Card, Icon, ListRow, Screen, type IconName } from '../components/ui'
import { LANGS, STRINGS, useLanguage, useT, type Lang } from '../i18n'
import { maskMsisdn } from '../lib/format'
import { setFloatingEnabled, useFloating } from '../lib/floating'
import { chooseProfilePhoto, removeProfilePhoto } from '../lib/profilePhoto'
import { getSoundbox, setSoundbox, testSoundbox } from '../lib/soundbox'
import { serviceIcon, useLocalized, useServices } from '../lib/services'
import { useAppMode, useAuth } from '../state/Auth'
import { useAppState } from '../state/AppState'
import { useMoqoqo } from '../state/useMoqoqo'
import { APP } from '../lib/variant'
import { colors, displayMode, onBackground, radius, setDisplayMode, type DisplayMode } from '../theme'
import { ICON_SIZES, ICON_STYLES, setIconSize, setIconStyle, useIconSize, useIconStyle, type IconStyle } from '../lib/iconStyle'

type RowKey = 'security' | 'privacy' | 'notifications' | 'tap' | 'requests' | 'nfc' | 'language' | 'display' | 'icons' | 'lite' | 'intro' | 'findUs' | 'stopOrders' | 'feedback' | 'contact' | 'share' | 'help'

const ALL_ROWS: [RowKey, IconName, string][] = [
  ['security', 'lock-closed', '#5B2C9F'],
  ['privacy', 'chatbubbles', '#0F766E'],
  ['notifications', 'notifications', '#DB2777'],
  ['tap', 'wifi', '#E0482F'],
  ['requests', 'receipt', '#D97706'],
  ['nfc', 'pricetag', '#0EA5E9'],
  ['language', 'language', '#16A34A'],
  ['display', 'contrast', '#14151A'],
  ['icons', 'apps', '#0EA5E9'],
  ['lite', 'leaf', '#65A30D'],
  ['intro', 'sparkles', '#2E3A8C'],
  ['stopOrders', 'repeat', '#0F766E'],
  ['findUs', 'location', '#5B2C9F'],
  ['feedback', 'star', '#F59E0B'],
  ['contact', 'call', '#16A34A'],
  ['share', 'share-social', '#2563EB'],
  ['help', 'help-circle', '#6B7280'],
]
// Business terminals don't pay by tap or keep NFC tags, and EcoSure doesn't take payments by tap: their settings are
// security, notifications, language and help.
const rowsFor = (mode: AppKind) => mode !== 'customer' ? ALL_ROWS.filter(([k]) => k === 'security' || k === 'notifications' || k === 'language' || k === 'display' || k === 'icons' || k === 'findUs' || k === 'feedback' || k === 'contact' || k === 'share' || k === 'help') : ALL_ROWS

/** One icon drawn in a given style, for the Me › Icons choices (they show their own style, not the current one). */
function IconPreview({ style, icon, color }: { style: IconStyle; icon: IconName; color: string }) {
  if (style === 'classic') return <Avatar name="" icon={icon} color={color} size={30} fixed />
  return <Icon name={style === 'minimal' ? (`${icon}-outline` as IconName) : icon} size={22} color={style === 'minimal' ? colors.muted : onBackground(color)} />
}

/** Profile and settings, shared by the customer app and EcoCash Business. */
export default function MeScreen() {
  const { toast } = useMoqoqo()
  const { lang, setLang } = useLanguage()
  const t = useT()
  const { session, biometrics, setBiometricsEnabled, lock, signOut, updateUser, inBusiness, ownerName, closeBusiness } = useAuth()
  const mode = useAppMode()
  const ROWS = rowsFor(mode)
  const iconStyle = useIconStyle()
  const floating = useFloating()
  // Me › Contact us and Share the app: the portal's details (Settings › Contact us), or placeholders until it answers.
  const contact = useAppState().state.config?.contact ?? CONTACT_DEFAULTS
  const shareApp = () => Share.share({ message: t.me.shareMessage(contact.shareLink) }).catch(() => {})
  const [rating, setRating] = useState(0)
  const [feedback, setFeedback] = useState('')
  const sendFeedback = async () => {
    try {
      await api('/v1/feedback', { body: { rating, text: feedback.trim() || undefined, app: APP, appVersion: Application.nativeApplicationVersion ?? undefined } })
      setSheet(null)
      setRating(0)
      setFeedback('')
      toast(t.me.feedbackThanks)
    } catch {
      toast(t.errors.UNKNOWN)
    }
  }
  /** Me › profile picture: a new one from the camera or photos, or none. */
  const changePhoto = async (how: 'camera' | 'photos' | null) => {
    setSheet(null)
    try {
      const me = how ? await chooseProfilePhoto(how) : await removeProfilePhoto()
      if (me === 'denied') toast(how === 'camera' ? t.svc.cameraDenied : t.svc.photosDenied)
      else if (me) {
        updateUser(me)
        toast(how ? t.me.photoSaved : t.me.photoRemoved)
      }
    } catch {
      toast(t.errors.UNKNOWN)
    }
  }
  const policy = session?.user.messagePolicy ?? 'everyone'
  /** Me › Who can message me: everyone, or friends only (others go to Message requests). */
  const setPolicy = async (messagePolicy: 'everyone' | 'friends') => {
    try {
      updateUser(await api<Me>('/v1/me/privacy', { method: 'PUT', body: { messagePolicy } }))
    } catch {
      toast(t.errors.UNKNOWN)
    }
  }
  const iconSize = useIconSize()
  const pathname = usePathname()
  const [sheet, setSheet] = useState<'language' | 'display' | 'icons' | 'privacy' | 'photo' | 'feedback' | 'contact' | 'security' | 'logout' | 'username' | null>(null)
  const [name, setName] = useState('')
  // Help starts with the EcoCash Assistant; it hands over to a person in EcoCash Support when needed.
  const { state } = useAppState()
  const openHelp = () => {
    const chat = Object.values(state.chats).find((c) => c.assistant)
    if (chat) router.push({ pathname: '/chat/[id]', params: { id: chat.id } })
    else router.push('/chats')
  }
  const [soundbox, setSoundboxState] = useState(APP === 'business' || inBusiness)
  useEffect(() => {
    getSoundbox().then(setSoundboxState, () => {})
  }, [])
  const [nameError, setNameError] = useState<string | null>(null)
  const saveUsername = async () => {
    try {
      const me = await api<Me>('/v1/me/username', { method: 'PUT', body: { username: name } })
      updateUser(me)
      setSheet(null)
      toast(t.me.usernameSaved(me.username ?? ''))
    } catch (e) {
      setNameError(e instanceof ApiFailure && e.message ? e.message : t.errors.UNKNOWN)
    }
  }
  const bioKind = t.auth.bioName(biometrics.face)
  const user = session?.user
  const L = useLocalized()
  const { services: meServices } = useServices('me')
  const sub = user?.code ? (user.role === 'agent' ? t.biz.agent(user.code) : t.biz.merchant(user.code)) : t.me.tier

  // Self service: built-in screens, then whatever the portal puts in Me (e.g. Update KYC).
  const selfService: { key: string; icon: IconName; color: string; title: string; subtitle: string; onPress: () => void }[] = [
    { key: 'history', icon: 'receipt-outline', color: '#0EA5E9', title: t.svc.history, subtitle: t.svc.historySub, onPress: () => router.push('/transactions') },
    { key: 'statement', icon: 'document-text-outline', color: '#0B1D86', title: t.statement.title, subtitle: t.statement.meSub, onPress: () => router.push('/statement') },
    { key: 'pin', icon: 'keypad-outline', color: '#5B2C9F', title: t.svc.changePin, subtitle: t.svc.changePinSub, onPress: () => router.push('/change-pin') },
    { key: 'phones', icon: 'phone-portrait-outline', color: '#16A34A', title: t.phones.title, subtitle: t.phones.meSub, onPress: () => router.push('/devices') },
    { key: 'pending', icon: 'hourglass-outline', color: '#D97706', title: t.svc.pending, subtitle: t.svc.pendingSub, onPress: () => router.push('/pending') },
    // Portal services open EcoCash Super App's service screens, which the EcoSure app doesn't have.
    ...(APP === 'ecosure' ? [] : meServices).map((sv) => ({
      key: sv.id, icon: serviceIcon(sv), color: sv.color, title: L(sv.name), subtitle: L(sv.description),
      onPress: () => router.push({ pathname: '/service/[id]', params: { id: sv.id } }),
    })),
  ]

  const toggleBiometrics = async () => {
    setSheet(null)
    if (!biometrics.available) return toast(t.auth.bioMissing)
    const on = !biometrics.enabled
    if (await setBiometricsEnabled(on)) toast(t.auth.bioStatus(bioKind, on))
  }

  const choose = (l: Lang) => {
    setSheet(null)
    if (l === lang) return
    setLang(l)
    toast(STRINGS[l].me.languageSet)
  }

  return (
    <Screen>
      <Text style={m.title}>{t.me.title}</Text>
      <Card style={m.profile}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.me.photo} onPress={() => setSheet('photo')}>
          <Avatar name={user?.businessName ?? user?.name ?? ''} size={60} color={colors.primary} photo={user?.photo} />
          <View style={m.camera}><Icon name="camera" size={13} color="#fff" /></View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={m.name}>{user?.businessName ?? user?.name}</Text>
          <Text style={m.sub}>{user && maskMsisdn(user.msisdn)} · {sub}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setName(user?.username ?? ''); setNameError(null); setSheet('username') }} style={{ marginTop: 4 }}>
            <Text style={m.username}>{user?.username ? `@${user.username}` : t.me.setUsername}</Text>
          </Pressable>
        </View>
        <Icon name="qr-code-outline" size={26} color={colors.primary} />
      </Card>
      {inBusiness && (
        <Card style={{ marginTop: 14, paddingVertical: 4 }}>
          <ListRow last onPress={closeBusiness} left={<Avatar name="back" icon="swap-horizontal" color={colors.primary} size={40} />}
            title={t.business.back} subtitle={t.business.backSub(ownerName ?? '')} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
        </Card>
      )}
      <Text style={m.section}>{t.svc.selfService}</Text>
      <Card style={{ paddingVertical: 4 }}>
        {selfService.map((r, i) => (
          <ListRow key={r.key} last={i === selfService.length - 1} onPress={r.onPress} left={<Avatar name={r.title} icon={r.icon} color={r.color} size={40} />}
            title={r.title} subtitle={r.subtitle} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
        ))}
      </Card>

      <Card style={{ marginTop: 14, paddingVertical: 4 }}>
        {mode === 'customer' && <ListRow left={<Avatar name="floating" icon="albums" color="#7C3AED" size={40} />} title={t.floating.meRow[0]} subtitle={t.floating.meRow[1]}
          right={<Switch value={floating.enabled} onValueChange={setFloatingEnabled} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel={t.floating.meRow[0]} />} />}
        {(APP === 'customer' || APP === 'business') && <ListRow left={<Avatar name="soundbox" icon="volume-high" color="#0EA5E9" size={40} />} title={t.me.soundbox[0]} subtitle={t.me.soundbox[1]}
          right={<Switch value={soundbox} onValueChange={async (on) => { setSoundboxState(on); await setSoundbox(on); if (on) testSoundbox(lang) }}
            trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" accessibilityLabel={t.me.soundbox[0]} />} />}
        {ROWS.map(([key, icon, color], i) => {
          const [name, sub] = key === 'language' ? [t.me.language, t.langName] : key === 'display' ? [t.me.display, t.me.displayModes[displayMode]] : key === 'icons' ? [t.me.icons, `${t.me.iconStyles[iconStyle]} · ${t.me.iconSizes[iconSize]}`] : key === 'privacy' ? [t.friends.privacy[0], t.friends.policies[policy]] : key === 'notifications' ? t.notifications.meRow : t.me[key]
          const open = () => (key === 'language' || key === 'display' || key === 'icons' || key === 'privacy' || key === 'security' ? setSheet(key) : key === 'notifications' ? router.push('/notifications') : key === 'help' ? openHelp() : key === 'intro' ? router.push('/onboarding') : key === 'findUs' ? router.push('/places') : key === 'stopOrders' ? router.push('/stop-orders') : key === 'feedback' || key === 'contact' ? setSheet(key) : key === 'share' ? shareApp() : toast(name))
          return (
            <ListRow key={key} last={i === ROWS.length - 1} onPress={open}
              left={<Avatar name={name} icon={icon} color={color} size={40} />}
              title={name} subtitle={sub} right={<Icon name="chevron-forward" size={18} color={colors.muted} />} />
          )
        })}
      </Card>

      <Button label={t.auth.logout} icon="log-out-outline" variant="ghost" onPress={() => setSheet('logout')} style={m.logout} />

      <Sheet typing visible={sheet === 'username'} title={t.me.usernameTitle} onClose={() => setSheet(null)}>
        <Text style={m.logoutBody}>{t.me.usernameHint}</Text>
        <View style={m.nameField}>
          <Text style={m.at}>@</Text>
          <TextInput style={m.nameInput} value={name} onChangeText={(v) => { setName(v.replace(/[^A-Za-z0-9._]/g, '').slice(0, 20)); setNameError(null) }}
            autoCapitalize="none" autoCorrect={false} placeholder="lerato.m" placeholderTextColor={colors.muted} accessibilityLabel={t.me.usernameTitle} onSubmitEditing={saveUsername} />
        </View>
        {nameError && <Text style={m.nameError}>{nameError}</Text>}
        <Button label={t.me.saveUsername} disabled={!USERNAME_PATTERN.test(name.toLowerCase())} onPress={saveUsername} />
      </Sheet>

      <Sheet visible={sheet === 'logout'} title={t.auth.logoutTitle} onClose={() => setSheet(null)}>
        <Text style={m.logoutBody}>{t.auth.logoutBody}</Text>
        <Button label={t.auth.logout} icon="log-out-outline" onPress={() => { setSheet(null); signOut() }} style={{ backgroundColor: colors.danger }} />
        <Button label={t.auth.stayIn} variant="ghost" onPress={() => setSheet(null)} />
      </Sheet>

      <Sheet visible={sheet === 'security'} title={t.me.security[0]} onClose={() => setSheet(null)}>
        <SheetOption icon={biometrics.face ? 'scan' : 'finger-print'} color="#5B2C9F" title={t.auth.unlockWith(bioKind)}
          subtitle={biometrics.available ? t.auth.bioStatus(bioKind, biometrics.enabled) : t.auth.bioMissing}
          selected={biometrics.enabled} onPress={toggleBiometrics} />
        <SheetOption icon="lock-closed" color="#0F766E" title={t.auth.lockNow} subtitle={t.auth.lockNowSub} onPress={() => { setSheet(null); lock() }} />
        <SheetOption icon="log-out" color="#DC2626" title={t.auth.logout} subtitle={user ? t.auth.logoutSub(maskMsisdn(user.msisdn)) : ''}
          onPress={() => setSheet('logout')} />
      </Sheet>

      <Sheet visible={sheet === 'display'} title={t.me.display} onClose={() => setSheet(null)}>
        {(['system', 'light', 'dark'] as DisplayMode[]).map((mode) => (
          <SheetOption key={mode} icon={mode === 'system' ? 'phone-portrait' : mode === 'light' ? 'sunny' : 'moon'} color={mode === 'dark' ? '#14151A' : mode === 'light' ? '#F59E0B' : '#5B2C9F'}
            title={t.me.displayModes[mode]} subtitle={t.me.displayHints[mode]} selected={mode === displayMode}
            onPress={() => { setSheet(null); setDisplayMode(mode, pathname).catch(() => {}) }} />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'photo'} title={t.me.photo} onClose={() => setSheet(null)}>
        <SheetOption icon="camera" color={colors.primary} title={t.me.photoTake} subtitle="" onPress={() => changePhoto('camera')} />
        <SheetOption icon="images" color="#0EA5E9" title={t.me.photoPick} subtitle="" onPress={() => changePhoto('photos')} />
        {user?.photo && <SheetOption icon="trash" color={colors.danger} title={t.me.photoRemove} subtitle="" onPress={() => changePhoto(null)} />}
      </Sheet>

      <Sheet typing visible={sheet === 'feedback'} title={t.me.feedback[0]} onClose={() => setSheet(null)}>
        <Text style={m.feedbackHint}>{t.me.feedbackHint}</Text>
        <View style={m.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} / 5`} accessibilityState={{ selected: n <= rating }} onPress={() => setRating(n)} hitSlop={6}>
              <Icon name={n <= rating ? 'star' : 'star-outline'} size={36} color={n <= rating ? '#F59E0B' : colors.muted} />
            </Pressable>
          ))}
        </View>
        <TextInput style={m.feedbackInput} value={feedback} onChangeText={setFeedback} multiline maxLength={2000}
          placeholder={t.me.feedbackPlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={t.me.feedbackPlaceholder} />
        <Button label={t.me.feedbackSend} disabled={rating === 0} onPress={sendFeedback} />
      </Sheet>

      <Sheet visible={sheet === 'contact'} title={t.me.contact[0]} onClose={() => setSheet(null)}>
        <SheetOption icon="call" color="#16A34A" title={t.me.contactCall(contact.phone)} subtitle="" onPress={() => { setSheet(null); Linking.openURL(`tel:${contact.phone.replace(/\s/g, '')}`) }} />
        {contact.whatsapp !== '' && <SheetOption icon="logo-whatsapp" color="#25D366" title={t.me.contactWhatsapp} subtitle={contact.whatsapp}
          onPress={() => { setSheet(null); Linking.openURL(`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}`) }} />}
        {contact.email !== '' && <SheetOption icon="mail" color="#2563EB" title={t.me.contactEmail} subtitle={contact.email} onPress={() => { setSheet(null); Linking.openURL(`mailto:${contact.email}`) }} />}
        {contact.website !== '' && <SheetOption icon="globe" color="#0F766E" title={t.me.contactWebsite} subtitle={contact.website.replace(/^https?:\/\//, '')} onPress={() => { setSheet(null); Linking.openURL(contact.website) }} />}
        <SheetOption icon="chatbubbles" color={colors.primary} title={t.me.contactChat} subtitle="" onPress={() => { setSheet(null); openHelp() }} />
      </Sheet>

      <Sheet visible={sheet === 'privacy'} title={t.friends.privacy[0]} onClose={() => setSheet(null)}>
        {(['everyone', 'friends'] as const).map((p) => (
          <SheetOption key={p} icon={p === 'everyone' ? 'globe-outline' : 'people'} color="#0F766E" title={t.friends.policies[p]} subtitle={t.friends.policyHints[p]}
            selected={p === policy} onPress={() => { setSheet(null); setPolicy(p) }} />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'icons'} title={t.me.icons} onClose={() => setSheet(null)}>
        <Text style={m.iconSizeLabel}>{t.me.iconSize}</Text>
        <View style={m.iconSizes} accessibilityRole="radiogroup">
          {ICON_SIZES.map((size, i) => (
            <Pressable key={size} accessibilityRole="radio" accessibilityState={{ selected: size === iconSize }} accessibilityLabel={t.me.iconSizes[size]}
              onPress={() => setIconSize(size)} style={[m.iconSize, size === iconSize && m.iconSizeOn]}>
              <Icon name="apps" size={[16, 20, 25][i]} color={size === iconSize ? '#fff' : colors.muted} />
              <Text style={[m.iconSizeText, size === iconSize && { color: '#fff' }]}>{t.me.iconSizes[size]}</Text>
            </Pressable>
          ))}
        </View>
        {ICON_STYLES.map((style) => (
          <Pressable key={style} accessibilityRole="radio" accessibilityState={{ selected: style === iconStyle }} onPress={() => { setIconStyle(style); setSheet(null) }}
            style={[m.iconOption, style === iconStyle && m.iconOptionOn]}>
            <View style={m.iconPreview}>
              {/* A small preview in that style: EcoSure, LEC, Split bill. */}
              {([['shield-checkmark', '#5B2FD1'], ['flash', '#F59E0B'], ['document-text', '#0EA5E9']] as const).map(([icon, color]) => (
                <IconPreview key={icon} style={style} icon={icon} color={color} />
              ))}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={m.iconTitle}>{t.me.iconStyles[style]}</Text>
              <Text style={m.iconHint}>{t.me.iconHints[style]}</Text>
            </View>
            {style === iconStyle && <Icon name="checkmark-circle" size={22} color={colors.primary} />}
          </Pressable>
        ))}
      </Sheet>

      <Sheet visible={sheet === 'language'} title={t.me.language} onClose={() => setSheet(null)}>
        {LANGS.map((l) => (
          <SheetOption key={l} icon="language" color="#16A34A" title={STRINGS[l].langName} subtitle={STRINGS[l].langHint}
            selected={l === lang} onPress={() => choose(l)} />
        ))}
      </Sheet>
    </Screen>
  )
}

const m = StyleSheet.create({
  feedbackHint: { fontSize: 15, color: colors.text, textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 16 },
  feedbackInput: { minHeight: 96, textAlignVertical: 'top', fontSize: 15, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  camera: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  iconSizeLabel: { fontSize: 13, fontWeight: '700', color: colors.muted, marginBottom: 8, letterSpacing: 0.4 },
  iconSizes: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  iconSize: { flex: 1, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  iconSizeOn: { backgroundColor: colors.primary },
  iconSizeText: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  iconOption: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 10, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: 'transparent' },
  iconOptionOn: { borderColor: colors.primary },
  iconPreview: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 106, justifyContent: 'center' },
  iconTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  iconHint: { fontSize: 13, color: colors.muted, marginTop: 2 },
  username: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
  nameField: { flexDirection: 'row', alignItems: 'center', height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, marginBottom: 10 },
  at: { fontSize: 18, fontWeight: '700', color: colors.muted, marginRight: 4 },
  nameInput: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text },
  nameError: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: 16 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  logout: { marginTop: 20 },
  logoutBody: { textAlign: 'center', color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: 6, paddingHorizontal: 8 },
})

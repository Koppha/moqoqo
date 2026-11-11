import Constants from 'expo-constants'
import { APP_NAMES, type AppKind } from '../../shared/api'

const variant = Constants.expoConfig?.extra?.variant

/** Which app this build is: EcoCash Super App, EcoCash Business (agents and merchants), or the standalone EcoSure or Mekhatlo app. Set by APP_VARIANT at build time. */
export const APP: AppKind = variant === 'business' || variant === 'ecosure' || variant === 'society' ? variant : 'customer'

/** This app's name where texts name the app the person is using (sign-up, unlock): EcoCash Super App, EcoCash Business or EcoSure. */
export const APP_NAME = APP_NAMES[APP]

/** EcoCash Super App API base URL. Emulator: `adb reverse tcp:4000 tcp:4000` makes localhost reach this machine. */
export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000'

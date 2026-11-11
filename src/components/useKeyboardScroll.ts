import { useEffect, useRef, useState } from 'react'
import { Keyboard, Platform, TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from 'react-native'

/**
 * Keeps the field being typed in, and the button just below it (Continue, Next), above the keyboard. The screen
 * already shrinks for the keyboard (KeyboardAvoidingView), but nothing scrolls the field into the smaller space, and
 * tall keyboards (Samsung's has a toolbar) cover what sits under it. Spread the result on the ScrollView.
 */
export function useKeyboardScroll(below = 120) {
  const ref = useRef<ScrollView>(null)
  const y = useRef(0)
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      const input = TextInput.State.currentlyFocusedInput()
      if (!input) return
      const keyboardTop = e.endCoordinates.screenY
      // After the screen has shrunk for the keyboard, so the scroll has room to move.
      setTimeout(() => {
        input.measureInWindow((_x, top, _w, height) => {
          const hidden = top + height + below - keyboardTop
          if (hidden > 0) ref.current?.scrollTo({ y: y.current + hidden, animated: true })
        })
      }, 50)
    })
    return () => sub.remove()
  }, [below])
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = e.nativeEvent.contentOffset.y
  }
  return { ref, onScroll, scrollEventThrottle: 16 }
}

/**
 * Whether the keyboard is open. While it is, the space a screen gives up for it (KeyboardAvoidingView) already covers
 * the navigation bar, so bottom insets under a composer or pinned button would only leave a gap above the keyboard.
 */
export function useKeyboardShown() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  return shown
}

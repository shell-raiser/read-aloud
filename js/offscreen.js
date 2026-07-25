
(function() {
  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')

  registerMessageListener("offscreen", {
    play: play,
    pause: pause,
    resume: resume,
    getColorScheme: getColorScheme,
  })

  sendToPlayer({method: "offscreenCheckIn"})
    .catch(console.error)
  sendToServiceWorker({method: "updateColorScheme", args: [getColorScheme()]})
    .catch(console.error)

  if (colorSchemeQuery.addEventListener) {
    colorSchemeQuery.addEventListener("change", handleColorSchemeChange)
  }
  else {
    colorSchemeQuery.addListener(handleColorSchemeChange)
  }



  const current$ = new rxjs.BehaviorSubject(null)

  current$.pipe(
    rxjs.switchMap(current => {
      if (current) {
        return playAudioHere(Promise.resolve(current.url), current.options, current.playbackState$).pipe(
          rxjs.catchError(err => rxjs.of({type: "error", error: errorToJson(err)})),
          rxjs.tap(event => {
            sendToPlayer({method: "offscreenPlaybackEvent", args: [event]})
              .catch(console.error)
          })
        )
      } else {
        return rxjs.EMPTY
      }
    })
  ).subscribe()



  function play(url, options) {
    current$.next({
      url,
      options,
      playbackState$: new rxjs.BehaviorSubject("resumed")
    })
    return true
  }

  function pause() {
    current$.value.playbackState$.next("paused")
    return true
  }

  function resume() {
    current$.value.playbackState$.next("resumed")
    return true
  }

  function getColorScheme() {
    return colorSchemeQuery.matches ? "dark" : "light"
  }

  function handleColorSchemeChange() {
    sendToServiceWorker({method: "updateColorScheme", args: [getColorScheme()]})
      .catch(console.error)
  }



  async function sendToPlayer(message) {
    message.dest = "player"
    const result = await brapi.runtime.sendMessage(message)
    if (result && result.error) throw result.error
    else return result
  }

  async function sendToServiceWorker(message) {
    message.dest = "serviceWorker"
    const result = await brapi.runtime.sendMessage(message)
    if (result && result.error) throw result.error
    else return result
  }
})();

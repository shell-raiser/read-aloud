
(function() {
  registerMessageListener("contentScript", {
    getRequireJs: getRequireJs,
    getDocumentInfo: getInfo,
    getCurrentIndex: getCurrentIndex,
    getTexts: getTexts
  })

  function getInfo() {
    return {
      url: location.href,
      title: document.title,
      lang: getLang(),
    }
  }

  function getLang() {
    var lang = document.documentElement.lang || $("html").attr("xml:lang");
    if (lang) lang = lang.split(",",1)[0].replace(/_/g, '-');
    return lang;
  }

  function getRequireJs() {
    if (location.hostname == "docs.google.com") {
      if (/^\/presentation\/d\//.test(location.pathname)) return ["js/content/google-slides.js"];
      else if (/\/document\/d\//.test(location.pathname)) return ["js/content/googleDocsUtil.js", "js/content/google-doc.js"];
      else if ($(".drive-viewer-paginated-scrollable").length) return ["js/content/google-drive-doc.js"];
      else return ["js/content/html-doc.js"];
    }
    else if (location.hostname == "drive.google.com") {
      if ($(".drive-viewer-paginated-scrollable").length) return ["js/content/google-drive-doc.js"];
      else return ["js/content/google-drive-preview.js"];
    }
    else if (location.hostname == "onedrive.live.com" && $(".OneUp-pdf--loaded").length) return ["js/content/onedrive-doc.js"];
    else if (/^read\.amazon\./.test(location.hostname)) return ["js/content/kindle-book.js"];
    else if (location.hostname.endsWith(".khanacademy.org")) return ["js/content/khan-academy.js"];
    else if (location.hostname.endsWith("acrobatiq.com")) return ["js/content/html-doc.js", "js/content/acrobatiq.js"];
    else if (location.hostname == "digital.wwnorton.com") return ["js/content/html-doc.js", "js/content/wwnorton.js"];
    else if (location.hostname == "plus.pearson.com") return ["js/content/html-doc.js", "js/content/pearson.js"];
    else if (location.hostname == "www.ixl.com") return ["js/content/ixl.js"];
    else if (location.hostname == "www.webnovel.com" && location.pathname.startsWith("/book/")) return ["js/content/webnovel.js"];
    else if (location.hostname == "archiveofourown.org") return ["js/content/archiveofourown.js"];
    else if (location.hostname == "chat.openai.com") return ["js/content/chatgpt.js"];
    else if (location.pathname.match(/readaloud\.html$/)
      || location.pathname.match(/\.pdf$/)
      || $("embed[type='application/pdf']").length
      || $("iframe[src*='.pdf']").length) return ["js/content/pdf-doc.js"];
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)
        && location.port === "1122"
        && location.protocol === "http:"
        && location.pathname === "/bookshelf/index.html") return  ["js/content/yd-app-web.js"];
    else return ["js/content/html-doc.js"];
  }

  async function getCurrentIndex() {
    if (await getSelectedText()) return -100;
    else return readAloudDoc.getCurrentIndex();
  }

  async function getTexts(index, quietly) {
    if (index < 0) {
      if (index == -100) return (await getSelectedText()).split(paragraphSplitter);
      else return null;
    }
    else {
      return Promise.resolve(readAloudDoc.getTexts(index, quietly))
        .then(function(texts) {
          if (texts && Array.isArray(texts)) {
            if (!quietly) console.log(texts.join("\n\n"));
          }
          return texts;
        })
    }
  }

  function getSelectedText() {
    if (readAloudDoc.getSelectedText) return readAloudDoc.getSelectedText()
    return window.getSelection().toString().trim();
  }


  getSettings()
    .then(settings => {
      if (settings.fixBtSilenceGap)
        setInterval(updateSilenceTrack.bind(null, Math.random()), 5000)
    })
    .catch(console.error)

  setupInPageHighlightingMvp()
    .catch(console.error)

  async function updateSilenceTrack(providerId) {
    if (!audioCanPlay()) return;
    const silenceTrack = getSilenceTrack()
    try {
      const should = await sendToPlayer({method: "shouldPlaySilence", args: [providerId]})
      if (should) silenceTrack.start()
      else silenceTrack.stop()
    }
    catch (err) {
      silenceTrack.stop()
    }
  }

  function audioCanPlay() {
    return navigator.userActivation && navigator.userActivation.hasBeenActive
  }

  async function sendToPlayer(message) {
    message.dest = "player"
    const result = await brapi.runtime.sendMessage(message)
    if (result && result.error) throw result.error
    else return result
  }

  async function setupInPageHighlightingMvp() {
    const mode = Number(await getSetting("showHighlighting") || defaults.showHighlighting)
    console.log("Read Aloud page highlighting setup", {mode, href: location.href})
    if (mode !== 3) return

    const ui = createInPageHighlightUi()
    ui.show()
    let active = false

    setInterval(async () => {
      try {
        const latestMode = Number(await getSetting("showHighlighting") || defaults.showHighlighting)
        if (latestMode !== 3) {
          ui.hide()
          active = false
          return
        }
        const stateInfo = await sendToPlayer({method: "getPlaybackState"})
        const state = stateInfo && stateInfo.state
        const speech = stateInfo && stateInfo.speechInfo
        console.log("Read Aloud page highlighting poll", {
          state,
          hasSpeech: !!speech,
          textCount: speech && speech.texts ? speech.texts.length : 0
        })
        const isActive = ["LOADING", "PLAYING", "PAUSED"].includes(state) && speech
        if (!isActive) {
          if (state == "STOPPED") {
            ui.resetSession()
            ui.hide()
          }
          active = false
          return
        }

        if (!active) {
          ui.resetSession()
          ui.show()
        }
        active = true
        ui.render(state, speech)
      }
      catch (err) {
        console.error("Read Aloud page highlighting failed", err)
        ui.clear()
        active = false
      }
    }, 400)
  }

  function createInPageHighlightUi() {
    console.log("Read Aloud page highlighting create UI")
    const toolbarHeight = 44
    const root = $("<div>")
      .attr("id", "readaloud-page-highlight-root")
      .css({
        position: "fixed",
        top: "14px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        display: "none",
        pointerEvents: "none",
      })
      .appendTo(document.documentElement)

    const toolbar = $("<div>")
      .css({
        pointerEvents: "auto",
        position: "relative",
        height: toolbarHeight + "px",
        background: "rgba(20, 20, 20, .85)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,.12)",
        borderRadius: "9999px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(10px)",
        boxShadow: "0 8px 24px rgba(0,0,0,.22)",
        padding: "0 8px",
      })
      .appendTo(root)

    let dismissed = false

    const controls = $("<div>")
      .css({
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
      })
      .appendTo(toolbar)

    const makeButton = (text, action) => $("<button>")
      .text(text)
      .css({
        border: 0,
        borderRadius: "9999px",
        minWidth: "36px",
        height: "32px",
        padding: "0 12px",
        background: "rgba(255,255,255,.16)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "13px",
      })
      .on("click", action)
      .appendTo(controls)

    makeButton("⏮", () => sendToPlayer({method: "rewind"}))
    const playPauseButton = makeButton("Pause", async () => {
      const {state} = await sendToPlayer({method: "getPlaybackState"})
      if (state == "PLAYING" || state == "LOADING") await sendToPlayer({method: "pause"})
      else await sendToPlayer({method: "resume"})
    })
    makeButton("⏭", () => sendToPlayer({method: "forward"}))

    $("<button>")
      .text("✕")
      .css({
        width: "32px",
        height: "32px",
        border: 0,
        borderRadius: "9999px",
        background: "rgba(255,255,255,.16)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "16px",
        lineHeight: 1,
        marginLeft: "6px",
      })
      .on("click", async () => {
        dismissed = true
        ui.hide()
        await sendToPlayer({method: "stop"})
      })
      .appendTo(controls)

    const layer = $("<div>")
      .attr("id", "readaloud-page-highlight-layer")
      .css({
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 2147483646,
      })
      .appendTo(document.body || document.documentElement)

    let lastMatchKey = null
    let lastMatchedElement = null
    let lastGlobalStart = 0
    let cachedPageMap = null
    let cacheTime = 0

    $(window).on("scroll resize", () => {
      if (toolbar.is(":visible")) renderHighlights()
    })

    function refreshPageMap(force) {
      if (!force && cachedPageMap && Date.now() - cacheTime < 2000) return cachedPageMap
      cachedPageMap = collectPageTextMap()
      cacheTime = Date.now()
      return cachedPageMap
    }

    function collectPageTextMap() {
      const ignoreSelector = typeof readAloudDoc != "undefined" && readAloudDoc && readAloudDoc.ignoreTags
        ? readAloudDoc.ignoreTags
        : "select, textarea, button, label, audio, video, dialog, embed, menu, nav, noframes, noscript, object, script, style, svg, aside, footer, #footer, .no-read-aloud, [aria-hidden=true]"

      const elems = $(".read-aloud").filter(":visible").get()
      const segments = elems.length
        ? elems.flatMap(elem => extractReadAloudSegments(elem, ignoreSelector))
        : collectFallbackSegments(ignoreSelector)

      let text = ""
      const boundaries = []
      segments.forEach((segment, index) => {
        const startIndex = text.length
        text += segment.text
        boundaries.push({
          elem: segment.elem,
          map: segment.map,
          localStart: segment.localStart,
          localEnd: segment.localEnd,
          startIndex,
          endIndex: text.length
        })
        if (index < segments.length - 1) text += "\n\n"
      })
      return {text, boundaries}
    }

    function collectFallbackSegments(ignoreSelector) {
      const selectors = [
        "p", "li", "dd", "dt", "blockquote", "pre",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "td", "th", "figcaption", "article", "section"
      ].join(", ")

      return $(selectors)
        .filter(function() {
          if (!$(this).is(":visible")) return false
          if ($(this).closest("#readaloud-page-highlight-root").length) return false
          if (ignoreSelector && $(this).closest(ignoreSelector).length) return false
          return getInnerText(this).length >= 2
        })
        .get()
        .flatMap(elem => makeSegmentsFromElement(elem))
        .filter(isNotEmpty)
    }

    function extractReadAloudSegments(elem, ignoreSelector) {
      if ($(elem).data("read-aloud-multi-block")) {
        return $(elem).children(":visible").get()
          .flatMap(child => makeSegmentsFromElement(child))
          .filter(isNotEmpty)
      }
      return makeSegmentsFromElement(elem).filter(isNotEmpty)
    }

    function makeSegmentsFromElement(elem) {
      if (!elem || !$(elem).is(":visible")) return []
      const map = createTextMap(elem)
      const fullText = prepareTextForPlayback(map.text)
      if (!fullText) return []

      const parts = addMissingPunctuationForHighlighting(elem.innerText).split(paragraphSplitter)
        .map(prepareTextForPlayback)
        .filter(isNotEmpty)

      if (parts.length <= 1) {
        return [{
          elem,
          map,
          text: fullText,
          localStart: 0,
          localEnd: map.text.length
        }]
      }

      const segments = []
      let searchStart = 0
      parts.forEach(part => {
        let localStart = fullText.indexOf(part, searchStart)
        if (localStart < 0) localStart = fullText.indexOf(part)
        if (localStart < 0) return
        const localEnd = Math.min(map.text.length, localStart + part.length)
        segments.push({
          elem,
          map,
          text: part,
          localStart,
          localEnd
        })
        searchStart = localEnd
      })
      return segments.length ? segments : [{
        elem,
        map,
        text: fullText,
        localStart: 0,
        localEnd: map.text.length
      }]
    }

    function normalizeTextForMatch(text) {
      return (text || "")
        .replace(/https?:\/\/\S+/g, "HTTP URL.")
        .replace(/\s+/g, " ")
        .trim()
    }

    function prepareTextForPlayback(text) {
      text = normalizeTextForMatch(addMissingPunctuationForHighlighting(text))
      if (/[\w)]$/.test(text)) text += "."
      return text
    }

    function createTextMap(elem) {
      const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
          const parent = node.parentElement
          if (!parent || !$(parent).is(":visible")) return NodeFilter.FILTER_REJECT
          if ($(parent).closest("#readaloud-page-highlight-root").length) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        }
      })

      let text = ""
      const mapping = []
      let node
      let pendingSpace = false
      while ((node = walker.nextNode())) {
        for (let i=0; i<node.nodeValue.length; i++) {
          const char = node.nodeValue[i]
          if (/\s/.test(char)) {
            pendingSpace = text.length > 0
            continue
          }
          if (pendingSpace) {
            text += " "
            mapping.push({node, offset: i})
            pendingSpace = false
          }
          text += char
          mapping.push({node, offset: i})
        }
      }
      return {text, mapping}
    }

    function resolveMatch(text) {
      const target = prepareTextForPlayback(text)
      if (!target) return null

      const pageMap = refreshPageMap(target !== lastMatchKey)
      let globalStart = findBestGlobalStart(pageMap.text, target)
      if (globalStart < 0) return null
      const globalEnd = Math.min(globalStart + target.length, pageMap.text.length)
      const matches = pageMap.boundaries
        .filter(boundary => boundary.endIndex > globalStart && boundary.startIndex < globalEnd)
        .map(boundary => {
          const startIndex = Math.max(boundary.localStart, boundary.localStart + globalStart - boundary.startIndex)
          const endIndex = Math.min(boundary.localEnd, boundary.localStart + globalEnd - boundary.startIndex)
          return {
            elem: boundary.elem,
            map: boundary.map,
            startIndex,
            endIndex
          }
        })
        .filter(match => match.endIndex > match.startIndex)

      if (!matches.length) return null
      const primary = choosePrimaryMatch(matches)
      lastMatchKey = target
      lastMatchedElement = primary.elem
      lastGlobalStart = globalStart
      return {
        elem: primary.elem,
        matches,
        primary
      }
    }

    function findBestGlobalStart(haystack, target) {
      let index = haystack.indexOf(target, Math.max(0, lastGlobalStart - 10))
      if (index >= 0) return index

      if (target.endsWith(".")) {
        index = haystack.indexOf(target.slice(0, -1), Math.max(0, lastGlobalStart - 10))
        if (index >= 0) return index
      }

      index = haystack.indexOf(target)
      if (index >= 0) return index

      if (target.endsWith(".")) {
        index = haystack.indexOf(target.slice(0, -1))
        if (index >= 0) return index
      }

      const prefix = target.slice(0, Math.min(target.length, 32)).trim()
      const suffix = target.slice(Math.max(0, target.length - 32)).trim()

      if (prefix.length >= 12) {
        index = haystack.indexOf(prefix, Math.max(0, lastGlobalStart - 10))
        if (index >= 0) return index
      }

      if (suffix.length >= 12) {
        const suffixIndex = haystack.indexOf(suffix, Math.max(0, lastGlobalStart - 10))
        if (suffixIndex >= 0) return Math.max(0, suffixIndex - Math.max(0, target.length - suffix.length))
      }

      return findNearestBoundaryMatch(haystack, target)
    }

    function findNearestBoundaryMatch(haystack, target) {
      const words = target.split(/\s+/).filter(Boolean)
      if (words.length < 3) return -1

      const prefix = words.slice(0, Math.min(words.length, 5)).join(" ")
      const suffix = words.slice(Math.max(0, words.length - 5)).join(" ")
      let bestIndex = -1
      let bestDistance = Infinity
      let searchFrom = 0

      while (true) {
        const prefixIndex = haystack.indexOf(prefix, searchFrom)
        if (prefixIndex < 0) break

        const expectedSuffixStart = prefixIndex + Math.max(0, target.length - suffix.length)
        const suffixWindowStart = Math.max(prefixIndex, expectedSuffixStart - 40)
        const suffixWindowEnd = Math.min(haystack.length, expectedSuffixStart + 40)
        const suffixIndex = haystack.slice(suffixWindowStart, suffixWindowEnd).indexOf(suffix)

        if (suffixIndex >= 0) {
          const candidate = prefixIndex
          const distance = Math.abs(candidate - lastGlobalStart)
          if (distance < bestDistance) {
            bestDistance = distance
            bestIndex = candidate
          }
        }

        searchFrom = prefixIndex + 1
      }

      return bestIndex
    }

    function choosePrimaryMatch(matches) {
      if (lastMatchedElement) {
        const same = matches.find(item => item.elem === lastMatchedElement)
        if (same) return same
      }
      return matches[0]
    }

    function makeRange(map, startIndex, endIndex) {
      if (!map.mapping.length) return null
      const start = map.mapping[Math.max(0, startIndex)]
      const end = map.mapping[Math.max(0, endIndex - 1)]
      if (!start || !end) return null
      const range = document.createRange()
      range.setStart(start.node, start.offset)
      range.setEnd(end.node, end.offset + 1)
      return range
    }

    function paintRange(range, color, inset) {
      if (!range) return
      Array.from(range.getClientRects()).forEach(rect => {
        if (rect.width < 2 || rect.height < 2) return
        $("<div>")
          .css({
            position: "absolute",
            left: rect.left - inset,
            top: rect.top - inset,
            width: rect.width + inset * 2,
            height: rect.height + inset * 2,
            background: color,
            borderRadius: "6px",
            boxShadow: color === "rgba(255, 208, 0, 0.85)" ? "0 0 0 1px rgba(120, 90, 0, 0.18)" : "none",
          })
          .appendTo(layer)
      })
    }

    function scrollIntoView(elem) {
      const rect = elem.getBoundingClientRect()
      if (rect.top >= 70 && rect.bottom <= window.innerHeight - 24) return
      elem.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      })
    }

    let currentState = null
    let currentSpeech = null

    function renderHighlights() {
      layer.empty()
      if (!currentSpeech || !currentSpeech.position) return

      const activeText = currentSpeech.texts && currentSpeech.texts[currentSpeech.position.index]
      const match = resolveMatch(activeText)
      if (!match) return

      if (currentState === "PLAYING") scrollIntoView(match.primary.elem)

      match.matches.forEach(item => {
        const lineRange = makeRange(item.map, item.startIndex, item.endIndex)
        paintRange(lineRange, "rgba(64, 156, 255, 0.28)", 2)
      })

      const word = currentSpeech.position.word
      if (word && word.endIndex > word.startIndex && match.matches.length == 1) {
        const onlyMatch = match.matches[0]
        const wordText = normalizeTextForMatch(activeText.slice(word.startIndex, word.endIndex))
        let wordStart = word.startIndex
        let wordEnd = word.endIndex
        if (wordText) {
          const localIndex = onlyMatch.map.text.slice(onlyMatch.startIndex, onlyMatch.endIndex).indexOf(wordText)
          if (localIndex >= 0) {
            wordStart = onlyMatch.startIndex + localIndex
            wordEnd = wordStart + wordText.length
          }
          else {
            wordStart = onlyMatch.startIndex + word.startIndex
            wordEnd = onlyMatch.startIndex + word.endIndex
          }
        }
        else {
          wordStart = onlyMatch.startIndex + word.startIndex
          wordEnd = onlyMatch.startIndex + word.endIndex
        }
        wordStart = Math.max(onlyMatch.startIndex, Math.min(wordStart, onlyMatch.endIndex - 1))
        wordEnd = Math.max(wordStart + 1, Math.min(wordEnd, onlyMatch.endIndex))
        paintRange(makeRange(onlyMatch.map, wordStart, wordEnd), "rgba(255, 208, 0, 0.85)", 1)
      }
    }

    function render(state, speech) {
      if (state == "STOPPED") {
        ui.hide()
        return
      }
      if (dismissed) return
      playPauseButton.text(state == "PAUSED" ? "Play" : "Pause")
      currentState = state
      currentSpeech = speech
      renderHighlights()
    }

    const ui = {
      show() {
        console.log("Read Aloud page highlighting show root")
        root.show()
        layer.show()
      },
      hide() {
        console.log("Read Aloud page highlighting hide root")
        layer.empty()
        layer.hide()
        root.hide()
        currentState = null
        currentSpeech = null
      },
      clear() {
        layer.empty()
      },
      resetSession() {
        dismissed = false
        lastMatchKey = null
        lastMatchedElement = null
        lastGlobalStart = 0
      },
      render
    }
    return ui
  }
})()


//helpers --------------------------

var paragraphSplitter = /(?:\s*\r?\n\s*){2,}/;

function getInnerText(elem) {
  var text = elem.innerText;
  return text ? text.trim() : "";
}

function addMissingPunctuationForHighlighting(text) {
  return (text || "").replace(/(\w)(\s*?\r?\n)/g, "$1.$2");
}

function isNotEmpty(text) {
  return text;
}

function fixParagraphs(texts) {
  var out = [];
  var para = "";
  for (var i=0; i<texts.length; i++) {
    if (!texts[i]) {
      if (para) {
        out.push(para);
        para = "";
      }
      continue;
    }
    if (para) {
      if (/[-\u2013\u2014]$/.test(para)) para = para.substr(0, para.length-1);
      else para += " ";
    }
    para += texts[i].replace(/[-\u2013\u2014]\r?\n/g, "");
    if (texts[i].match(/[.!?:)"'\u2019\u201d]$/)) {
      out.push(para);
      para = "";
    }
  }
  if (para) out.push(para);
  return out;
}

function tryGetTexts(getTexts, millis) {
  return waitMillis(500)
    .then(getTexts)
    .then(function(texts) {
      if (texts && !texts.length && millis-500 > 0) return tryGetTexts(getTexts, millis-500);
      else return texts;
    })
}

function loadPageScript(url) {
  if (!$("head").length) $("<head>").prependTo("html");
  $.ajax({
    dataType: "script",
    cache: true,
    url: url
  });
}

function simulateMouseEvent(element, eventName, coordX, coordY) {
  element.dispatchEvent(new MouseEvent(eventName, {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: coordX,
    clientY: coordY,
    button: 0
  }));
}

function simulateClick(elementToClick) {
  var box = elementToClick.getBoundingClientRect(),
      coordX = box.left + (box.right - box.left) / 2,
      coordY = box.top + (box.bottom - box.top) / 2;
  simulateMouseEvent (elementToClick, "mousedown", coordX, coordY);
  simulateMouseEvent (elementToClick, "mouseup", coordX, coordY);
  simulateMouseEvent (elementToClick, "click", coordX, coordY);
}

const getMath = (function() {
  let promise = Promise.resolve(null)
  return () => promise = promise.then(math => math || makeMath())
})();

async function makeMath() {
  const getXmlFromMathEl = function(mathEl) {
    const clone = mathEl.cloneNode(true)
    $("annotation, annotation-xml", clone).remove()
    removeAllAttrs(clone, true)
    return clone.outerHTML
  }

  //determine the mml markup
  const math =
    when(document.querySelector(".MathJax, .MathJax_Preview"), {
      selector: ".MathJax[data-mathml]",
      getXML(el) {
        const mathEl = el.querySelector("math")
        return mathEl ? getXmlFromMathEl(mathEl) : el.getAttribute("data-mathml")
      },
    })
    .when(() => document.querySelector("math"), {
      selector: "math",
      getXML: getXmlFromMathEl,
    })
    .else(null)

  if (!math) return null
  const elems = $(math.selector).get()
  if (!elems.length) return null

  //create speech surrogates
  try {
    const xmls = elems.map(math.getXML)
    const texts = await ajaxPost(config.serviceUrl + "/read-aloud/mathml", xmls, "json").then(JSON.parse)
    elems.forEach((el, i) => $("<span>").addClass("readaloud-mathml").text(texts[i] || "math expression").insertBefore(el))
  }
  catch (err) {
    console.error(err)
    return {
      show() {},
      hide() {}
    }
  }

  //return functions to toggle between mml and speech
  return {
    show() {
      for (const el of elems) el.style.setProperty("display", "none", "important")
      $(".readaloud-mathml").show()
    },
    hide() {
      $(elems).css("display", "")
      $(".readaloud-mathml").hide()
    }
  }
}

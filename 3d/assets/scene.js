import { contentMap } from './content-map.js';

const sceneHost = document.querySelector('#three-scene');
const enableButton = document.querySelector('#enable-three');
const status = document.querySelector('#three-status');
const nodeList = document.querySelector('#node-list');
const readerPanel = document.querySelector('#reader-panel');
const readerTitle = document.querySelector('#reader-title');
const readerSummary = document.querySelector('#reader-summary');
const readerContent = document.querySelector('#reader-content');
const sourceLink = document.querySelector('#source-link');
const sceneSelection = document.querySelector('#scene-selection');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = navigator.connection && navigator.connection.saveData;
const narrowScreen = window.matchMedia('(max-width: 540px)').matches;
let sceneIsVisible = false;
let enhancementRequested = false;
let sceneState;
let activeRequest;
let requestGeneration = 0;
const groupColors = { '入口': 0x315ed9, '工程': 0x6b53bd, '品質': 0x16816a, '運用': 0xc16622, '導入': 0xa84d72 };

function setStatus(message) {
  status.textContent = message;
}

function canEnhance() {
  return !reducedMotion && !saveData && !narrowScreen && 'WebGLRenderingContext' in window;
}

function selectedNode(id) {
  return contentMap.find((node) => node.id === id);
}

function updateControlState(id) {
  const node = selectedNode(id);
  nodeList.querySelectorAll('[data-node]').forEach((control) => {
    const isSelected = control.dataset.node === id;
    control.setAttribute('aria-current', String(isSelected));
  });
  if (node) sceneSelection.textContent = `選択中の工程: ${node.group} / ${node.label}`;
  if (sceneState) {
    sceneState.meshes.forEach(({ id: meshId, group, mesh }) => {
      mesh.material.color.set(meshId === id ? 0xe75f49 : groupColors[group]);
      mesh.scale.setScalar(meshId === id ? 1.35 : 1);
    });
    sceneState.render();
  }
}

function sourceUrlFor(node) {
  return new URL(node.href, window.location.href);
}

function removeUnsafeContent(fragment) {
  fragment.querySelectorAll('script, style, link, meta, base, title, noscript, iframe, object, embed, form, svg, math, video, audio, source, track, picture, canvas').forEach((element) => element.remove());
  fragment.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name);
    });
    element.removeAttribute('style');
    element.removeAttribute('srcset');
  });
}

function sameOriginRelativeUrl(value, sourceUrl, allowFragment = false) {
  if (allowFragment && value.startsWith('#')) return value;
  try {
    const resolved = new URL(value, sourceUrl);
    if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== sourceUrl.origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

function safeAnchorUrl(value, sourceUrl) {
  if (value.startsWith('#')) return { href: value, isExternal: false };
  try {
    const resolved = new URL(value, sourceUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    if (resolved.origin === sourceUrl.origin) {
      return { href: `${resolved.pathname}${resolved.search}${resolved.hash}`, isExternal: false };
    }
    return { href: resolved.href, isExternal: true };
  } catch {
    return null;
  }
}

function resolveRelativeUrls(fragment, sourceUrl) {
  fragment.querySelectorAll('[href]').forEach((element) => {
    if (element.tagName !== 'A') {
      element.removeAttribute('href');
      return;
    }
    const safeUrl = safeAnchorUrl(element.getAttribute('href') || '', sourceUrl);
    if (safeUrl === null) {
      element.removeAttribute('href');
      return;
    }
    element.setAttribute('href', safeUrl.href);
    if (safeUrl.isExternal) {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    } else {
      element.removeAttribute('target');
      element.removeAttribute('rel');
    }
  });
  fragment.querySelectorAll('[src]').forEach((element) => {
    const safeUrl = sameOriginRelativeUrl(element.getAttribute('src') || '', sourceUrl);
    if (safeUrl === null) element.remove();
    else element.setAttribute('src', safeUrl);
  });
}

async function showSource(node) {
  const requestId = ++requestGeneration;
  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const sourceUrl = sourceUrlFor(node);
  sourceLink.href = sourceUrl.href;
  sourceLink.textContent = `「${node.label}」の元ページを開く`;
  readerTitle.textContent = node.label;
  readerSummary.textContent = node.summary;
  readerPanel.hidden = false;
  readerContent.replaceChildren(Object.assign(document.createElement('p'), { textContent: '正本ページを読み込んでいます。' }));

  if (sourceUrl.origin !== window.location.origin) {
    readerContent.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'この表示では同一オリジンのページだけを読み込みます。元ページを開いてください。' }));
    if (requestId === requestGeneration) activeRequest = undefined;
    return;
  }

  try {
    const response = await fetch(sourceUrl, { credentials: 'same-origin', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const sourceMain = parsed.querySelector('main');
    if (!sourceMain) throw new Error('main was not found');
    const safeFragment = document.createDocumentFragment();
    [...sourceMain.childNodes].forEach((child) => safeFragment.append(child.cloneNode(true)));
    removeUnsafeContent(safeFragment);
    resolveRelativeUrls(safeFragment, sourceUrl);
    if (requestId !== requestGeneration) return;
    readerContent.replaceChildren(safeFragment);
  } catch {
    if (requestId !== requestGeneration || controller.signal.aborted) return;
    readerContent.replaceChildren(Object.assign(document.createElement('p'), { textContent: '本文を読み込めませんでした。上のリンクから元のページを開いてください。' }));
  } finally {
    if (requestId === requestGeneration) activeRequest = undefined;
  }
}

function selectNode(id, { focusReader = false } = {}) {
  const node = selectedNode(id);
  if (!node) return;
  updateControlState(node.id);
  history.replaceState(null, '', `#${node.id}`);
  showSource(node);
  if (focusReader) readerTitle.focus({ preventScroll: true });
}

function scheduleWhenIdle(callback) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 1200 });
  } else {
    window.setTimeout(callback, 220);
  }
}

async function startScene() {
  if (sceneState || !enhancementRequested || !sceneIsVisible) return;
  try {
    const THREE = await import('./vendor/three-r185/three.module.min.js');
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
    const size = () => ({ width: Math.max(sceneHost.clientWidth, 1), height: Math.max(sceneHost.clientHeight, 1) });
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    const scene = new THREE.Scene();
    camera.position.set(0, 0, 11);
    const geometry = new THREE.SphereGeometry(0.24, 12, 12);
    const meshes = contentMap.map((node) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: groupColors[node.group] }));
      mesh.position.set(...node.position);
      scene.add(mesh);
      return { id: node.id, group: node.group, label: node.label, mesh };
    });
    const linePoints = contentMap.flatMap((node, index) => index ? [contentMap[index - 1].position, node.position] : []);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints.map((point) => new THREE.Vector3(...point)));
    scene.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0x9ca6bc, transparent: true, opacity: 0.58 })));
    const render = () => {
      const { width, height } = size();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    sceneHost.replaceChildren(renderer.domElement);
    sceneHost.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      renderer.dispose();
      sceneHost.replaceChildren(Object.assign(document.createElement('p'), { textContent: '3D表示を停止しました。一覧から工程を開けます。' }));
      setStatus('WebGLの状態が変わったため、一覧表示を継続しています。');
    }, { once: true });
    sceneState = { meshes, render };
    new ResizeObserver(render).observe(sceneHost);
    render();
    updateControlState(window.location.hash.slice(1) || 'overview');
    setStatus('3D地図を有効にしました。工程の選択は下の一覧から行えます。');
  } catch {
    sceneHost.replaceChildren(Object.assign(document.createElement('p'), { textContent: '3D表示を開始できませんでした。一覧から工程を開けます。' }));
    setStatus('3D表示を開始できなかったため、一覧表示を継続しています。');
  }
}

nodeList.addEventListener('click', (event) => {
  const control = event.target.closest('[data-node]');
  if (!control) return;
  event.preventDefault();
  selectNode(control.dataset.node, { focusReader: true });
});

if (!canEnhance()) {
  enableButton.disabled = true;
  setStatus('この端末の設定または画面幅では、3D表示を使わず一覧を表示します。');
} else {
  enableButton.addEventListener('click', () => {
    enhancementRequested = true;
    enableButton.disabled = true;
    enableButton.textContent = '3D表示を準備中';
    scheduleWhenIdle(startScene);
  });
  new IntersectionObserver((entries, observer) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    sceneIsVisible = true;
    observer.disconnect();
    if (enhancementRequested) scheduleWhenIdle(startScene);
  }, { rootMargin: '180px' }).observe(sceneHost);
}

const initialNode = selectedNode(window.location.hash.slice(1));
if (initialNode) selectNode(initialNode.id);

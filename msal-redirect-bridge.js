(() => {
  function parseResponse(url) {
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    const hashParams = new URLSearchParams(hash);
    const queryParams = new URLSearchParams(query);
    const hasHashResponse = hashParams.has('state');
    const hasQueryResponse = queryParams.has('state');
    const params = hasHashResponse && hasQueryResponse
      ? new URLSearchParams(`${query}${hash}`)
      : hasHashResponse ? hashParams : hasQueryResponse ? queryParams : null;
    const payload = hasHashResponse && hasQueryResponse
      ? `${query}${hash}`
      : hasHashResponse ? hash : hasQueryResponse ? query : '';
    const state = params?.get('state');
    if (!state || !payload) {
      throw new Error('Microsoft did not return an authentication response.');
    }

    const base64 = state.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const stateData = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    ));
    if (typeof stateData.id !== 'string' || !stateData.id || !stateData.meta) {
      throw new Error('Microsoft returned an invalid authentication response.');
    }
    return { id: stateData.id, payload };
  }

  function clearResponseFromUrl() {
    window.history.replaceState(null, '', `${window.location.origin}${window.location.pathname}`);
  }

  function broadcastResponseToMainFrame() {
    const status = document.getElementById('redirectStatus');
    let response;
    try {
      response = parseResponse(new URL(window.location.href));
    } catch (error) {
      if (!new URL(window.location.href).hash.includes('state=')
          && !new URL(window.location.href).search.includes('state=')) {
        return;
      }
      clearResponseFromUrl();
      if (status) {
        status.textContent = 'Microsoft sign-in could not be completed. Close this window and try again.';
      }
      console.error('Could not process the Microsoft sign-in response.', error);
      return;
    }

    clearResponseFromUrl();
    try {
      const channel = new BroadcastChannel(response.id);
      channel.postMessage({ v: 1, payload: response.payload });
      channel.close();
      window.close();
    } catch (error) {
      if (status) {
        status.textContent = 'Microsoft sign-in could not return to the soundboard. Close this window and try again.';
      }
      console.error('Could not return the Microsoft sign-in response to the soundboard.', error);
    }
  }

  window.SoundboardMsalRedirectBridge = { broadcastResponseToMainFrame };
  broadcastResponseToMainFrame();
})();

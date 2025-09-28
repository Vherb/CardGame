export function resolveServerHost() {
	if (typeof window !== 'undefined') {
		const envHost = (process.env.REACT_APP_SERVER_HOST || '').trim();
		const winHost = (window.SERVER_HOST ? String(window.SERVER_HOST).trim() : '');
		let lsHost = '';
		try { lsHost = (localStorage.getItem('serverHost') || '').trim(); } catch {}
		const hostname = (window.location && window.location.hostname) || 'localhost';
		return envHost || winHost || lsHost || hostname;
	}
	return process.env.REACT_APP_SERVER_HOST || 'localhost';
}

export function wsProto() {
	if (typeof window !== 'undefined') return window.location.protocol === 'https:' ? 'wss' : 'ws';
	return 'ws';
}

export function httpProto() {
	if (typeof window !== 'undefined') return window.location.protocol === 'https:' ? 'https' : 'http';
	return 'http';
}

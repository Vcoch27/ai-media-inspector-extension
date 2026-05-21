export default function Popup() {
    return (<div style={{ width: 320, padding: 16, fontFamily: 'Arial, sans-serif' }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>AI Media Inspector</h2>

      <p style={{ marginTop: 8, color: '#555', fontSize: 13 }}>
        Detect AI-generated images directly on web pages.
      </p>

      <div style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 12,
            background: '#f3f4f6',
            fontSize: 14,
        }}>
        <strong>Status:</strong> Not logged in
      </div>

      <button style={{
            width: '100%',
            marginTop: 16,
            padding: '10px 12px',
            borderRadius: 10,
            border: 'none',
            background: '#2563eb',
            color: 'white',
            fontWeight: 600,
            cursor: 'pointer',
        }}>
        Login
      </button>

      <button style={{
            width: '100%',
            marginTop: 8,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #d1d5db',
            background: 'white',
            color: '#111827',
            fontWeight: 600,
            cursor: 'pointer',
        }}>
        Open Dashboard
      </button>
    </div>);
}

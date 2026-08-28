import "./App.css";

function App() {
  return (
    <main className="overlay">
      <input
        className="overlay-input"
        type="text"
        placeholder="Type a note…"
        autoFocus
        spellCheck={false}
      />
    </main>
  );
}

export default App;

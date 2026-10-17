import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <AuthGate>{(user, signOut) => <App user={user} onSignOut={signOut} />}</AuthGate>,
);

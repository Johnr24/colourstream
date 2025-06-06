import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  Container,
  Paper,
  CircularProgress,
  Divider,
} from '@mui/material';
import { authenticateWithPasskey, loginWithOIDC, handleOIDCCallback, getOIDCConfig } from '../utils/api';
import { PageHeading, Button, WarningText, InsetText } from './GovUkComponents';

const AdminLogin: React.FC = () => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [oidcProviderName, setOidcProviderName] = useState('Identity Provider');
  const [initializing, setInitializing] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Check if WebAuthn/passkey is supported
    const checkPasskeySupport = async () => {
      try {
        const supported = window.PublicKeyCredential !== undefined &&
          typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
        
        if (supported) {
          const result = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          setPasskeySupported(result);
        } else {
          setPasskeySupported(false);
        }
      } catch (error) {
        console.error('Error checking passkey support:', error);
        setPasskeySupported(false);
      }
    };

    // Check OIDC configuration
    const checkOIDCConfig = async () => {
      try {
        console.log('Checking OIDC config...');
        const oidcConfig = await getOIDCConfig();
        console.log('OIDC config response:', oidcConfig);
        const isEnabled = oidcConfig.config?.enabled || false;
        console.log('OIDC enabled:', isEnabled);
        setOidcEnabled(isEnabled);
        if (oidcConfig.config?.providerName) {
          setOidcProviderName(oidcConfig.config.providerName);
        }
        
        // Auto-redirect to OIDC login if enabled and not already in a callback flow
        const isOIDCCallback = location.pathname.includes('/callback') || 
                              location.search.includes('code=') || 
                              location.search.includes('error=');
        console.log('Is OIDC callback:', isOIDCCallback);
        console.log('Auth error in localStorage:', localStorage.getItem('authError'));
        console.log('Skip OIDC auto redirect in localStorage:', localStorage.getItem('skipOidcAutoRedirect'));
        
        if (isEnabled && !isOIDCCallback && !localStorage.getItem('authError') && !localStorage.getItem('skipOidcAutoRedirect')) {
          console.log('Auto-redirecting to OIDC login...');
          // Set a flag to prevent redirect loops
          localStorage.setItem('skipOidcAutoRedirect', 'true');
          // Redirect to OIDC login
          await loginWithOIDC(window.location.origin + '/admin/dashboard');
          return;
        }
      } catch (error) {
        console.error('Error checking OIDC config:', error);
        setOidcEnabled(false);
      } finally {
        setInitializing(false);
      }
    };

    checkPasskeySupport();
    checkOIDCConfig();

    // Check for stored error message
    const authError = localStorage.getItem('authError');
    if (authError) {
      setError(authError);
      localStorage.removeItem('authError');
      // Clear the auto-redirect skip flag when there's an error
      localStorage.removeItem('skipOidcAutoRedirect');
    }

    // Check if this is a callback from OIDC provider
    const isOIDCCallback = location.pathname.includes('/callback') || 
                          location.search.includes('code=') || 
                          location.search.includes('error=');
    
    if (isOIDCCallback) {
      // Handle the OIDC callback
      handleOIDCCallback()
        .catch(error => {
          console.error('Error handling OIDC callback:', error);
          setError('Failed to complete authentication');
          // Clear the auto-redirect skip flag when there's an error
          localStorage.removeItem('skipOidcAutoRedirect');
        });
    }

    // Cleanup function to remove the skip flag when component unmounts
    return () => {
      localStorage.removeItem('skipOidcAutoRedirect');
    };
  }, [location, navigate]);

  const handlePasskeyLogin = async () => {
    setError('');
    setLoading(true);

    try {
      await authenticateWithPasskey();
      navigate('/admin/dashboard');
    } catch (error: any) {
      console.error('Passkey authentication error:', error);
      
      if (error.message === 'User declined to authenticate with passkey') {
        setError('Authentication cancelled by user');
      } else if (error.response?.status === 400 && error.response?.data?.message === 'No passkey registered') {
        setError('No passkey registered. Please complete the first-time setup.');
      } else if (error.name === 'NotAllowedError') {
        setError('Authentication cancelled by user');
      } else if (error.name === 'SecurityError') {
        setError('Security error: The origin is not secure or does not match the registered origin');
      } else {
        setError(error.response?.data?.message || 'Passkey authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOIDCLogin = async () => {
    setError('');
    setLoading(true);

    try {
      // Pass the current URL as the return URL
      await loginWithOIDC(window.location.origin + '/admin/dashboard');
    } catch (error: any) {
      console.error('OIDC login error:', error);
      setError(error.message || 'OIDC login failed');
      setLoading(false);
    }
  };

  // Show loading indicator during initialization
  if (initializing) {
    return (
      <Container component="main" maxWidth="md">
        <Box sx={{ mt: 6, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
          <CircularProgress />
          <Typography variant="body1" sx={{ mt: 2 }}>
            Initializing authentication options...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (!passkeySupported && !oidcEnabled) {
    return (
      <Container component="main" maxWidth="md">
        <Box sx={{ mt: 6 }}>
          <PageHeading>Admin Login</PageHeading>
          <Paper sx={{ p: 4, backgroundColor: '#ffffff', borderRadius: 0 }}>
            <WarningText>
              Your device or browser does not support passkey authentication, and no alternative login method is configured.
            </WarningText>
            <Typography variant="body1" sx={{ mt: 2 }}>
              Please use a supported browser (like Chrome, Safari, or Edge) on a compatible device, or contact your administrator to enable alternative login methods.
            </Typography>
          </Paper>
        </Box>
      </Container>
    );
  }

  return (
    <Container component="main" maxWidth="md">
      <Box sx={{ mt: 6 }}>
        <PageHeading>Admin Login</PageHeading>
        
        {error && (
          <Box className="govuk-error-summary" role="alert" tabIndex={-1} aria-labelledby="error-summary-title">
            <Typography variant="h3" component="h2" className="govuk-error-summary__title" id="error-summary-title">
              There is a problem
            </Typography>
            <div className="govuk-error-summary__body">
              <Typography variant="body1">{error}</Typography>
            </div>
          </Box>
        )}

        <Paper sx={{ p: 4, backgroundColor: '#ffffff', borderRadius: 0, mb: 4 }}>
          <Typography variant="body1" sx={{ mb: 4 }}>
            Sign in to the admin dashboard using one of the available authentication methods.
          </Typography>
          
          {/* Show OIDC login first if enabled */}
          {oidcEnabled && (
            <Box sx={{ mb: 4 }}>
              <Typography variant="h6" gutterBottom>
                Single Sign-On (Recommended)
              </Typography>
              <Button
                onClick={handleOIDCLogin}
                disabled={loading}
                fullWidth={false}
                type="button"
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : `Sign in with ${oidcProviderName}`}
              </Button>
              
              <InsetText>
                This will redirect you to your organization's identity provider for authentication.
              </InsetText>
            </Box>
          )}
          
          {oidcEnabled && passkeySupported && (
            <Divider sx={{ my: 3 }}>
              <Typography variant="body2" color="text.secondary">OR</Typography>
            </Divider>
          )}
          
          {passkeySupported && (
            <Box sx={{ mt: oidcEnabled ? 2 : 0 }}>
              <Typography variant="h6" gutterBottom>
                Passkey Authentication
              </Typography>
              <Button
                onClick={handlePasskeyLogin}
                disabled={loading}
                fullWidth={false}
                type="button"
                variant={oidcEnabled ? "secondary" : "primary"}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign in with Passkey'}
              </Button>
              
              <InsetText>
                This will use your device's biometric sensors (fingerprint, face recognition) or PIN for authentication.
              </InsetText>
            </Box>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default AdminLogin; 
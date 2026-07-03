import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/hooks/useAuth';

/**
 * Root index — auth-aware redirect gate.
 * Unauthenticated → (auth)/login
 * Authenticated   → (app)/master-password (unlock vault)
 */
export default function Index() {
  const { isLoading, isAuthenticated } = useAuth();

  // Show a minimal loading state while Supabase resolves the session
  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#0A0A0F',
        }}
      >
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  if (isAuthenticated) {
    return <Redirect href="/(app)/master-password" />;
  }

  return <Redirect href="/(auth)/login" />;
}
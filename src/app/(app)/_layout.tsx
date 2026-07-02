import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="add-password" />
      <Stack.Screen name="vault-detail/[id]" />
      <Stack.Screen name="generator" />
      <Stack.Screen name="security-center" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="master-password" />
    </Stack>
  );
}

// The cloud account service reused from apps/mobile names one route of that app's navigator.
// T3 Car has no navigator, so the request it queues is never presented.
declare namespace ReactNavigation {
  interface RootParamList {
    ConnectOnboarding: undefined;
  }
}

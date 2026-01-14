<template>
  <div class="app">
    <LoginView v-if="!userStore.isLoggedIn" />
    <LoggedInView
      v-else-if="!showDeleteView && !showPrivateLayerView && !showDisablePrivateLayerView"
      @delete-account="showDeleteView = true"
      @private-layer="showPrivateLayerView = true"
      @change-password="handleChangePassword"
      @disable-private-layer="showDisablePrivateLayerView = true"
    />
    <DeleteAccountView v-else-if="showDeleteView" @cancel="showDeleteView = false" @complete="showDeleteView = false" />
    <DisablePrivateLayerView v-else-if="showDisablePrivateLayerView" @cancel="showDisablePrivateLayerView = false" @complete="handleDisablePrivateLayerComplete" />
    <PrivateLayerView v-else-if="showPrivateLayerView" :is-reset="isResettingPassword" :is-change-password="isUpdatingPassword" @cancel="handlePrivateLayerCancel" @complete="handlePrivateLayerComplete" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import LoginView from './views/LoginView.vue';
import LoggedInView from './views/LoggedInView.vue';
import DeleteAccountView from './views/DeleteAccountView.vue';
import DisablePrivateLayerView from './views/DisablePrivateLayerView.vue';
import PrivateLayerView from './views/PrivateLayerView.vue';
import { useUserStore } from './stores/user';
import { useWebverseStore } from './stores/webverse';

const userStore = useUserStore();
const webverseStore = useWebverseStore();

const showDeleteView = ref(false);
const showPrivateLayerView = ref(false);
const showDisablePrivateLayerView = ref(false);
const isResettingPassword = ref(false);
const isUpdatingPassword = ref(false);

const handleChangePassword = () => {
  showPrivateLayerView.value = true;
  isUpdatingPassword.value = true;
};

const handleDisablePrivateLayerComplete = () => {
  showDisablePrivateLayerView.value = false;
  // LoggedInView's storage listener will automatically update encryption status
};

const handlePrivateLayerCancel = () => {
  showPrivateLayerView.value = false;
  isResettingPassword.value = false;
  isUpdatingPassword.value = false;
};

const handlePrivateLayerComplete = () => {
  showPrivateLayerView.value = false;
  isResettingPassword.value = false;
  isUpdatingPassword.value = false;
};

// Watch for logout and reset view flags
watch(() => userStore.isLoggedIn, (isLoggedIn) => {
  if (!isLoggedIn) {
    showDeleteView.value = false;
    showPrivateLayerView.value = false;
    showDisablePrivateLayerView.value = false;
    isResettingPassword.value = false;
    isUpdatingPassword.value = false;
  }
});

onMounted(async () => {
  // Setup storage listener to sync with background changes
  userStore.listenToStorageChanges();

  await userStore.loadState();
  await webverseStore.checkCanLaunch();
  await webverseStore.checkWebverseStatus();
});
</script>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app {
  width: 320px;
  min-height: 350px;
}
</style>
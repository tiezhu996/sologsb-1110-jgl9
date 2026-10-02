import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { ensureTabId } from './utils/tab';
import './styles.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });

// 先完成页签身份握手（重复页签会复制 sessionStorage，需让后开者换 id），再挂载应用
void ensureTabId().then(() => {
  app.mount('#app');
});

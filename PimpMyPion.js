// ==UserScript==
// @name         Dreadcast - PimpMyPion
// @namespace    http://tampermonkey.net/
// @version      0.4.2
// @description  Ajoute un slider pour contrôler la taille des pions + affiche les avatars personnalisés des joueurs
// @author       Darlene
// @match        https://www.dreadcast.net/*
// @match        http://www.dreadcast.net/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // CONFIGURATION
  // ============================================================
  const CONFIG = Object.freeze({
    // Clefs stockage
    STORAGE_KEY_SIZE: 'dreadcast_avatar_size',
    STORAGE_KEY_ENABLED: 'dreadcast_avatar_enabled',

    // Paramètres de taille(en %)
    DEFAULT_SIZE: 75,
    MIN_SIZE: 50,
    MAX_SIZE: 200,

    // URLs & chemins
    AVATAR_BASE_URL: 'https://www.dreadcast.net/images/avatars/',

    // Timing (millisecondes)
    REAPPLY_INTERVAL: 50,
    RAF_THROTTLE: 16, // ~60 FPS
    INIT_DELAY: 2000,
    SECONDARY_DELAY: 5000,
    MENU_CHECK_INTERVAL: 500,
    MENU_CHECK_TIMEOUT: 10000,
    EVENT_ATTACH_DELAY: 100,

    // Z-indices
    Z_INDEX_AVATAR: 999,
    Z_INDEX_OVERLAY: 999999,
    Z_INDEX_PANEL: 1000000,

    // Selecteurs CSS
    SELECTOR_PIONS: '.personnages .icon_perso',
    SELECTOR_ICON: '.le_icon_perso',
    SELECTOR_INFO: '.info_a_afficher',
    SELECTOR_SETTINGS_MENU: '.parametres ul',

    // Classes CSS
    CLASS_AVATAR_IMG: 'custom-avatar-img',
    CLASS_CONNECTED: 'connecte',

    // Data attributes
    ATTR_AVATAR_STATUS: 'data-avatar-applied',
    ATTR_PLAYER_NAME: 'data-player-name',

    // Status avatars
    STATUS_SUCCESS: 'success',
    STATUS_FAILED: 'failed',

    // Couleurs
    COLOR_CONNECTED: '#4ade80',
    COLOR_DISCONNECTED: '#9ca3af',

    // Divers
    DEBUG_MODE: false
  });

  // ============================================================
  // Gestion des état
  // ============================================================
  class AvatarState {
    constructor() {
      this.avatarCache = new Map();
      this.avatarUrlCache = new Map();
      this.reapplyIntervalId = null;
      this.reapplyAnimationFrameId = null;
      this.lastReapplyTime = 0;
    }

    clearCaches() {
      this.avatarCache.clear();
      this.avatarUrlCache.clear();
    }

    stopReapplication() {
      if (this.reapplyIntervalId) {
        clearInterval(this.reapplyIntervalId);
        this.reapplyIntervalId = null;
      }
      if (this.reapplyAnimationFrameId) {
        cancelAnimationFrame(this.reapplyAnimationFrameId);
        this.reapplyAnimationFrameId = null;
      }
    }
  }

  const state = new AvatarState();

  // ============================================================
  // Fonctions utilitaires
  // ============================================================
  const Utils = {
    debugLog(message, ...args) {
      if (CONFIG.DEBUG_MODE) {
        console.log(`[Dreadcast PimpMyPion] ${message}`, ...args);
      }
    },

    encodePlayerName(name) {
      return encodeURIComponent(name);
    },

    buildAvatarUrl(playerName) {
      return `${CONFIG.AVATAR_BASE_URL}${this.encodePlayerName(playerName)}.png`;
    },

    throttle(fn, delay) {
      let lastCall = 0;
      return function (...args) {
        const now = Date.now();
        if (now - lastCall < delay) return;
        lastCall = now;
        fn.apply(this, args);
      };
    }
  };

  // ============================================================
  // Fonctions de stockage
  // ============================================================
  const Storage = {
    loadAvatarSize() {
      const savedSize = localStorage.getItem(CONFIG.STORAGE_KEY_SIZE);
      return savedSize ? parseInt(savedSize, 10) : CONFIG.DEFAULT_SIZE;
    },

    saveAvatarSize(size) {
      localStorage.setItem(CONFIG.STORAGE_KEY_SIZE, String(size));
      Utils.debugLog('✅ Taille sauvegardée:', `${size}%`);
    },

    loadAvatarEnabled() {
      const savedEnabled = localStorage.getItem(CONFIG.STORAGE_KEY_ENABLED);
      return savedEnabled === null ? true : savedEnabled === 'true';
    },

    saveAvatarEnabled(enabled) {
      localStorage.setItem(CONFIG.STORAGE_KEY_ENABLED, String(enabled));
      Utils.debugLog('✅ Affichage des avatars:', enabled ? 'activé' : 'désactivé');
    }
  };

  // ============================================================
  // DOM UTILITIES
  // ============================================================
  const DOMUtils = {
    getPlayerNameFromPion(pionElement) {
      try {
        const cachedName = pionElement.getAttribute(CONFIG.ATTR_PLAYER_NAME);
        if (cachedName) return cachedName;

        const infoElement = pionElement.querySelector(CONFIG.SELECTOR_INFO);
        if (infoElement?.textContent) {
          const playerName = infoElement.textContent.trim();
          pionElement.setAttribute(CONFIG.ATTR_PLAYER_NAME, playerName);
          return playerName;
        }
      } catch (error) {
        Utils.debugLog('❌ Erreur extraction nom joueur:', error);
      }
      return null;
    },

    isAvatarValid(pionElement) {
      const iconElement = pionElement.querySelector(CONFIG.SELECTOR_ICON);
      if (!iconElement) return false;

      const avatarImg = iconElement.querySelector(`.${CONFIG.CLASS_AVATAR_IMG}`);
      if (!avatarImg) return false;

      const isAttached = avatarImg.parentElement !== null;
      const isVisible = avatarImg.style.display !== 'none' &&
                        avatarImg.style.visibility !== 'hidden' &&
                        avatarImg.style.opacity !== '0';

      return isAttached && isVisible;
    },

    getAllPions() {
      return document.querySelectorAll(CONFIG.SELECTOR_PIONS);
    }
  };

  // ============================================================
  // Chargement des images
  // ============================================================
  const ImageLoader = {
    async checkImageExists(url, playerName) {
      if (state.avatarUrlCache.has(playerName)) {
        return state.avatarUrlCache.get(playerName).exists;
      }

      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          state.avatarUrlCache.set(playerName, { url, exists: true });
          resolve(true);
        };
        img.onerror = () => {
          state.avatarUrlCache.set(playerName, { url, exists: false });
          resolve(false);
        };
        img.src = url;
      });
    }
  };

  // ============================================================
  // Style des avatars
  // ============================================================
  const AvatarStyler = {
    createAvatarImage(avatarUrl, playerName) {
      const img = document.createElement('img');
      img.className = CONFIG.CLASS_AVATAR_IMG;
      img.src = avatarUrl;
      img.alt = playerName;
      img.setAttribute('loading', 'eager');
      img.setAttribute('decoding', 'sync');
      return img;
    },

    applyAvatarStyles(avatarImg, borderColor) {
      const styles = {
        width: '70px',
        height: '70px',
        'object-fit': 'cover',
        'border-radius': '50%',
        border: `3px solid ${borderColor}`,
        'box-shadow': '0 2px 8px rgba(0, 0, 0, 0.3)',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        'z-index': String(CONFIG.Z_INDEX_AVATAR),
        'pointer-events': 'none',
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        transition: 'none',
        animation: 'none'
      };

      Object.entries(styles).forEach(([property, value]) => {
        avatarImg.style.setProperty(property, value, 'important');
      });
    },

    getBorderColor(iconElement) {
      return iconElement.classList.contains(CONFIG.CLASS_CONNECTED)
        ? CONFIG.COLOR_CONNECTED
        : CONFIG.COLOR_DISCONNECTED;
    }
  };

  // ============================================================
  // Application des avatars
  // ============================================================
  const AvatarManager = {
    async applyCustomAvatar(pionElement, force = false) {
      try {
        if (!Storage.loadAvatarEnabled()) return;

        const cachedStatus = state.avatarCache.get(pionElement);

        if (!force && cachedStatus === CONFIG.STATUS_SUCCESS && DOMUtils.isAvatarValid(pionElement)) {
          return;
        }

        if (!force && cachedStatus === CONFIG.STATUS_FAILED) return;

        const playerName = DOMUtils.getPlayerNameFromPion(pionElement);
        if (!playerName) {
          state.avatarCache.set(pionElement, CONFIG.STATUS_FAILED);
          return;
        }

        const avatarUrl = Utils.buildAvatarUrl(playerName);

        if (!state.avatarUrlCache.has(playerName) || force) {
          const exists = await ImageLoader.checkImageExists(avatarUrl, playerName);
          if (!exists) {
            state.avatarCache.set(pionElement, CONFIG.STATUS_FAILED);
            pionElement.setAttribute(CONFIG.ATTR_AVATAR_STATUS, CONFIG.STATUS_FAILED);
            return;
          }
        } else if (!state.avatarUrlCache.get(playerName).exists) {
          return;
        }

        const iconElement = pionElement.querySelector(CONFIG.SELECTOR_ICON);
        if (!iconElement) return;

        let avatarImg = iconElement.querySelector(`.${CONFIG.CLASS_AVATAR_IMG}`);

        if (!avatarImg) {
          avatarImg = AvatarStyler.createAvatarImage(avatarUrl, playerName);
          if (iconElement.firstChild) {
            iconElement.insertBefore(avatarImg, iconElement.firstChild);
          } else {
            iconElement.appendChild(avatarImg);
          }
        } else if (!DOMUtils.isAvatarValid(pionElement)) {
          avatarImg.src = avatarUrl;
          avatarImg.alt = playerName;
        }

        const borderColor = AvatarStyler.getBorderColor(iconElement);
        AvatarStyler.applyAvatarStyles(avatarImg, borderColor);

        if (!avatarImg.complete || avatarImg.naturalHeight === 0) {
          avatarImg.src = avatarImg.src;
        }

        pionElement.setAttribute(CONFIG.ATTR_AVATAR_STATUS, CONFIG.STATUS_SUCCESS);
        pionElement.setAttribute(CONFIG.ATTR_PLAYER_NAME, playerName);
        state.avatarCache.set(pionElement, CONFIG.STATUS_SUCCESS);

      } catch (error) {
        Utils.debugLog('❌ Erreur application avatar:', error);
        state.avatarCache.set(pionElement, CONFIG.STATUS_FAILED);
      }
    },

    removeCustomAvatars() {
      document.querySelectorAll(`.${CONFIG.CLASS_AVATAR_IMG}`).forEach(img => img.remove());

      DOMUtils.getAllPions().forEach(pion => {
        pion.removeAttribute(CONFIG.ATTR_AVATAR_STATUS);
        pion.removeAttribute(CONFIG.ATTR_PLAYER_NAME);
      });

      state.avatarCache.clear();
      Utils.debugLog('✅ Avatars supprimés');
    },

    async applyAvatarsToAllPions(force = false) {
      if (!Storage.loadAvatarEnabled()) {
        this.removeCustomAvatars();
        return;
      }

      const pions = DOMUtils.getAllPions();
      Utils.debugLog(`🔍 ${pions.length} pion(s) trouvé(s)`);

      for (const pion of pions) {
        if (!force && DOMUtils.isAvatarValid(pion)) continue;
        await this.applyCustomAvatar(pion, force);
      }
    },

    reapplyAvatarsSync(force = false) {
      if (!Storage.loadAvatarEnabled()) return;

      DOMUtils.getAllPions().forEach(pion => {
        if (!force && DOMUtils.isAvatarValid(pion)) return;
        this.applyCustomAvatar(pion, force);
      });
    }
  };

  // ============================================================
  // Système de Réapplication rapide (réapplique les avatar quand DOM change -quand on bouge en jeu par exemple-)
  // Version rapide --> 60FPS, pour éviter au max de voir le "clignotement" des pions)
  // ============================================================
  const ReapplicationSystem = {
    ultraFastReapplication() {
      const now = Date.now();

      if (now - state.lastReapplyTime < CONFIG.RAF_THROTTLE) {
        state.reapplyAnimationFrameId = requestAnimationFrame(() => this.ultraFastReapplication());
        return;
      }

      state.lastReapplyTime = now;

      if (Storage.loadAvatarEnabled()) {
        AvatarManager.reapplyAvatarsSync(false);
      }

      state.reapplyAnimationFrameId = requestAnimationFrame(() => this.ultraFastReapplication());
    },

    start() {
      state.stopReapplication();
      Utils.debugLog('🔄 Démarrage système de réapplication');

      state.reapplyIntervalId = setInterval(() => {
        if (Storage.loadAvatarEnabled()) {
          AvatarManager.reapplyAvatarsSync(false);
        }
      }, CONFIG.REAPPLY_INTERVAL);

      this.ultraFastReapplication();
    },

    stop() {
      state.stopReapplication();
      Utils.debugLog('⏹️ Arrêt système de réapplication');
    }
  };

  // ============================================================
  // Systeme de taille & styles
  // ============================================================
  const SizingSystem = {
    applyAvatarSize(size) {
      const scale = size / 100;

      let styleElement = document.getElementById('dreadcast-avatar-resize-style');
      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'dreadcast-avatar-resize-style';
        document.head.appendChild(styleElement);
      }

      styleElement.textContent = `
        .personnages .icon_perso {
          transform: scale(${scale}) !important;
          transform-origin: center center !important;
        }

        .personnages .icon_perso .le_icon_perso {
          transform: scale(1) !important;
          position: relative !important;
        }

        .personnages .icon_perso {
          z-index: auto !important;
        }

        .${CONFIG.CLASS_AVATAR_IMG} {
          pointer-events: none !important;
          width: 70px !important;
          height: 70px !important;
          object-fit: cover !important;
          border-radius: 50% !important;
          border: 2px solid rgba(255, 255, 255, 0.8) !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
          position: absolute !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          z-index: ${CONFIG.Z_INDEX_AVATAR} !important;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          transition: none !important;
          animation: none !important;
        }

        .personnages .icon_perso .le_icon_perso > * {
          position: relative !important;
        }

        .personnages .icon_perso .le_icon_perso > .${CONFIG.CLASS_AVATAR_IMG} {
          z-index: ${CONFIG.Z_INDEX_AVATAR} !important;
        }

        .personnages .icon_perso .le_icon_perso > svg,
        .personnages .icon_perso .le_icon_perso > use {
          z-index: 1 !important;
        }
      `;
    }
  };

  // ============================================================
  // Composants UI
  // ============================================================
  const UIComponents = {
    createDraggableBehavior(element, handle) {
      let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
      let isDragging = false;

      handle.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();

        isDragging = true;

        // Désactiver le transform et fixer les positions AVANT de commencer le drag
        const rect = element.getBoundingClientRect();
        element.style.transform = 'none';
        element.style.top = `${rect.top}px`;
        element.style.left = `${rect.left}px`;

        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDrag;
        document.onmousemove = elementDrag;
      };

      function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = `${element.offsetTop - pos2}px`;
        element.style.left = `${element.offsetLeft - pos1}px`;
      }

      function closeDrag(e) {
        // Empêcher la propagation du mouseup vers l'overlay
        if (e) {
          e.stopPropagation();
        }
        isDragging = false;
        document.onmouseup = null;
        document.onmousemove = null;
      }
    },

    attachPanelEvents() {
      const closeBtn = document.getElementById('avatar-close-btn');
      const slider = document.getElementById('avatar-size-slider');
      const valueDisplay = document.getElementById('avatar-size-value');
      const resetBtn = document.getElementById('avatar-reset-btn');
      const avatarCheckbox = document.getElementById('avatar-enabled-checkbox');
      const panel = document.getElementById('dreadcast-avatar-config-panel');

      if (!closeBtn || !slider || !valueDisplay || !resetBtn || !avatarCheckbox) {
        Utils.debugLog('❌ Éléments du panneau introuvables');
        return;
      }

      const currentSize = Storage.loadAvatarSize();
      const avatarsEnabled = Storage.loadAvatarEnabled();

      slider.value = currentSize;
      valueDisplay.textContent = `${currentSize}%`;
      avatarCheckbox.checked = avatarsEnabled;

      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.style.display = 'none';
      });

      slider.addEventListener('input', function () {
        const size = parseInt(this.value, 10);
        valueDisplay.textContent = `${size}%`;
        SizingSystem.applyAvatarSize(size);
        Storage.saveAvatarSize(size);
      });

      avatarCheckbox.addEventListener('change', function () {
        const enabled = this.checked;
        Storage.saveAvatarEnabled(enabled);

        if (enabled) {
          Utils.debugLog('🖼️ Activation des avatars...');
          ReapplicationSystem.start();
          AvatarManager.applyAvatarsToAllPions(true);
        } else {
          Utils.debugLog('🚫 Désactivation des avatars...');
          ReapplicationSystem.stop();
          AvatarManager.removeCustomAvatars();
        }
      });

      resetBtn.addEventListener('click', () => {
        slider.value = CONFIG.DEFAULT_SIZE;
        valueDisplay.textContent = `${CONFIG.DEFAULT_SIZE}%`;
        avatarCheckbox.checked = true;

        SizingSystem.applyAvatarSize(CONFIG.DEFAULT_SIZE);
        Storage.saveAvatarSize(CONFIG.DEFAULT_SIZE);
        Storage.saveAvatarEnabled(true);

        state.clearCaches();
        ReapplicationSystem.start();
        AvatarManager.applyAvatarsToAllPions(true);
      });

      const dataBox = panel.querySelector('.dataBox');
      const head = panel.querySelector('.head');
      if (dataBox && head) {
        this.createDraggableBehavior(dataBox, head);
      }
    },

    createConfigPanel() {
      let panel = document.getElementById('dreadcast-avatar-config-panel');
      if (panel) return panel;

      panel = document.createElement('div');
      panel.id = 'dreadcast-avatar-config-panel';
      panel.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background-color: rgba(0, 0, 0, 0.7) !important;
        z-index: ${CONFIG.Z_INDEX_OVERLAY} !important;
        display: none !important;
      `;

      panel.innerHTML = `
        <div class="dataBox" style="position: fixed !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; z-index: ${CONFIG.Z_INDEX_PANEL} !important; width: 500px !important; background: #ffffff !important; border-radius: 12px !important; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;">
          <relative>
            <div class="head" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; padding: 20px !important; cursor: move !important; position: relative !important;">
              <div class="title" style="color: #ffffff !important; font-size: 18px !important; font-weight: 600 !important; text-align: center !important;">🎀 PmP</div>
              <div title="Fermer" class="close" id="avatar-close-btn" style="position: absolute !important; top: 15px !important; right: 15px !important; color: #ffffff !important; cursor: pointer !important; font-size: 24px !important; background: rgba(255, 255, 255, 0.2) !important; border-radius: 6px !important; width: 32px !important; height: 32px !important; display: flex !important; align-items: center !important; justify-content: center !important;">✕</div>
            </div>
            <div class="content" style="padding: 30px !important; background: #ffffff !important;">
              <div style="margin-bottom: 25px !important; padding: 18px !important; background: linear-gradient(135deg, #f6f8fb 0%, #eef2f7 100%) !important; border-left: 4px solid #667eea !important; border-radius: 8px !important;">
                <label style="display: flex !important; align-items: center !important; cursor: pointer !important;">
                  <input type="checkbox" id="avatar-enabled-checkbox" style="width: 20px !important; height: 20px !important; margin-right: 12px !important; cursor: pointer !important; accent-color: #667eea !important;">
                  <span style="font-size: 15px !important; color: #2d3748 !important; font-weight: 500 !important;">🖼️ Afficher les avatars des joueurs</span>
                </label>
                <div style="margin-top: 10px !important; font-size: 12px !important; color: #718096 !important; padding-left: 32px !important;">Remplace l'icône par défaut par l'avatar réel de chaque joueur</div>
              </div>

              <div style="margin-bottom: 25px !important;">
                <label style="display: block !important; margin-bottom: 15px !important; font-size: 15px !important; color: #2d3748 !important; font-weight: 500 !important;">
                  📏 Taille des pions : <span id="avatar-size-value" style="color: #667eea !important; font-weight: 700 !important;">100%</span>
                </label>
                <input type="range" id="avatar-size-slider" min="${CONFIG.MIN_SIZE}" max="${CONFIG.MAX_SIZE}" value="100" style="width: 100% !important; height: 6px !important; background: linear-gradient(to right, #e2e8f0, #667eea) !important; border-radius: 10px !important; cursor: pointer !important;">
                <style>
                  #avatar-size-slider::-webkit-slider-thumb {
                    -webkit-appearance: none !important;
                    width: 20px !important;
                    height: 20px !important;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                    border-radius: 50% !important;
                    cursor: pointer !important;
                    box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4) !important;
                  }
                  #avatar-size-slider::-webkit-slider-thumb:hover {
                    transform: scale(1.2) !important;
                  }
                  #avatar-size-slider::-moz-range-thumb {
                    width: 20px !important;
                    height: 20px !important;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                    border: none !important;
                    border-radius: 50% !important;
                    cursor: pointer !important;
                  }
                  #avatar-close-btn:hover {
                    background: rgba(255, 255, 255, 0.3) !important;
                    transform: rotate(90deg) !important;
                  }
                  #avatar-reset-btn:hover {
                    transform: translateY(-2px) !important;
                    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4) !important;
                  }
                </style>
              </div>

              <div style="text-align: center !important;">
                <button id="avatar-reset-btn" style="padding: 12px 30px !important; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; color: #ffffff !important; border: none !important; border-radius: 8px !important; cursor: pointer !important; font-size: 14px !important; font-weight: 600 !important;">🔄 Réinitialiser</button>
              </div>
            </div>
          </relative>
        </div>
      `;

      panel.addEventListener('click', (e) => {
        if (e.target === panel) {
          panel.style.display = 'none';
        }
      });

      const appendPanel = () => {
        if (document.body) {
          document.body.appendChild(panel);
          setTimeout(() => this.attachPanelEvents(), CONFIG.EVENT_ATTACH_DELAY);
        } else {
          setTimeout(appendPanel, CONFIG.MENU_CHECK_INTERVAL);
        }
      };

      appendPanel();
      return panel;
    },

    openConfigPanel() {
      let panel = document.getElementById('dreadcast-avatar-config-panel');
      if (!panel) {
        panel = this.createConfigPanel();
      }
      if (panel) {
        panel.style.display = 'block';
        Utils.debugLog('✅ Panneau ouvert');
      }
    }
  };

  // ============================================================
  // Intégration du menu
  // ============================================================
  const MenuIntegration = {
    addMenuOption() {
      const checkMenu = setInterval(() => {
        const parametresMenu = document.querySelector(CONFIG.SELECTOR_SETTINGS_MENU);

        if (parametresMenu) {
          clearInterval(checkMenu);

          if (document.getElementById('avatar-resize-menu-option')) return;

          const menuOption = document.createElement('li');
          menuOption.id = 'avatar-resize-menu-option';
          menuOption.className = 'link couleur2';
          menuOption.textContent = '🎀 PmP v0.4.2';
          menuOption.style.cursor = 'pointer';

          menuOption.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            UIComponents.openConfigPanel();
          }, true);

          const lastSeparator = parametresMenu.querySelector('.separator:last-of-type');
          if (lastSeparator) {
            parametresMenu.insertBefore(menuOption, lastSeparator);
          } else {
            parametresMenu.appendChild(menuOption);
          }

          Utils.debugLog('✅ Option menu ajoutée');
        }
      }, CONFIG.MENU_CHECK_INTERVAL);

      setTimeout(() => clearInterval(checkMenu), CONFIG.MENU_CHECK_TIMEOUT);
    }
  };

  // ============================================================
  // DOM OBSERVER
  // ============================================================
  const DOMObserver = {
    observe() {
      const targetNode = document.querySelector('.personnages');
      if (!targetNode) return;

      const observer = new MutationObserver((mutations) => {
        Utils.debugLog('🔍 Changement DOM détecté:', mutations.length);

        const currentSize = Storage.loadAvatarSize();
        SizingSystem.applyAvatarSize(currentSize);

        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1 && node.classList?.contains('icon_perso')) {
              Utils.debugLog('🆕 Nouveau pion détecté');
              AvatarManager.applyCustomAvatar(node, true);
            }
          });

          if (mutation.type === 'childList') {
            const target = mutation.target;
            const pionElement = target.classList?.contains('icon_perso')
              ? target
              : target.closest('.icon_perso');

            if (pionElement && !DOMUtils.isAvatarValid(pionElement)) {
              Utils.debugLog('⚠️ Pion modifié, réapplication...');
              AvatarManager.applyCustomAvatar(pionElement, true);
            }
          }
        });
      });

      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true
      });

      Utils.debugLog('✅ MutationObserver activé');
    }
  };

  // ============================================================
  // Initialisation
  // ============================================================
  function init() {
    Utils.debugLog('⚡ PimpMyPion - Initialisation');

    const savedSize = Storage.loadAvatarSize();
    SizingSystem.applyAvatarSize(savedSize);
    Utils.debugLog('✅ Taille appliquée:', `${savedSize}%`);

    MenuIntegration.addMenuOption();
    DOMObserver.observe();

    setTimeout(() => {
      Utils.debugLog('🖼️ Application initiale des avatars');
      AvatarManager.applyAvatarsToAllPions(true);

      if (Storage.loadAvatarEnabled()) {
        ReapplicationSystem.start();
      }
    }, CONFIG.INIT_DELAY);

    setTimeout(() => {
      Utils.debugLog('🔄 Réapplication de sécurité');
      AvatarManager.applyAvatarsToAllPions(true);
    }, CONFIG.SECONDARY_DELAY);
  }

  // Démarrer initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

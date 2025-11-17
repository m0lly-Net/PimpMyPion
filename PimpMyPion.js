// ==UserScript==
// @name         Dreadcast - PimpMyPion
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Ajoute un slider pour contrôler la taille des pions + affiche les avatars personnalisés des joueurs
// @author       Darlene
// @match        https://www.dreadcast.net/*
// @match        http://www.dreadcast.net/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================
    const CONFIG = {
        storageKey: 'dreadcast_avatar_size',
        avatarEnabledKey: 'dreadcast_avatar_enabled',
        defaultSize: 100, // Taille par défaut en pourcentage (100% = taille normale)
        minSize: 50,      // Taille minimale en pourcentage
        maxSize: 200,     // Taille maximale en pourcentage
        avatarBaseUrl: 'https://www.dreadcast.net/images/avatars/',
        reapplyInterval: 50, // RÉDUIT DE 500ms à 50ms pour une meilleure réactivité - évite les clignotements visibles
        debugMode: true // Activer les logs de débogage
    };

    // Cache pour optimiser les performances
    const avatarCache = new Map(); // Map<pionElement, avatarStatus>
    const avatarUrlCache = new Map(); // Map<playerName, { url: string, exists: boolean }>
    let reapplyIntervalId = null;
    let reapplyAnimationFrameId = null;
    let lastReapplyTime = 0;

    // ============================================================
    // FONCTION : Log de débogage
    // ============================================================
    function debugLog(message, ...args) {
        if (CONFIG.debugMode) {
            console.log(`[Dreadcast Avatar v2.2] ${message}`, ...args);
        }
    }

    // ============================================================
    // FONCTION : Charger la préférence de taille depuis localStorage
    // ============================================================
    function loadAvatarSize() {
        const savedSize = localStorage.getItem(CONFIG.storageKey);
        return savedSize ? parseInt(savedSize) : CONFIG.defaultSize;
    }

    // ============================================================
    // FONCTION : Sauvegarder la préférence de taille dans localStorage
    // ============================================================
    function saveAvatarSize(size) {
        localStorage.setItem(CONFIG.storageKey, size);
        debugLog('✅ Taille des avatars sauvegardée:', size + '%');
    }

    // ============================================================
    // FONCTION : Charger la préférence d'affichage des avatars
    // ============================================================
    function loadAvatarEnabled() {
        const savedEnabled = localStorage.getItem(CONFIG.avatarEnabledKey);
        // Par défaut, les avatars sont activés
        return savedEnabled === null ? true : savedEnabled === 'true';
    }

    // ============================================================
    // FONCTION : Sauvegarder la préférence d'affichage des avatars
    // ============================================================
    function saveAvatarEnabled(enabled) {
        localStorage.setItem(CONFIG.avatarEnabledKey, enabled);
        debugLog('✅ Affichage des avatars:', enabled ? 'activé' : 'désactivé');
    }

    // ============================================================
    // FONCTION : Extraire le nom du joueur depuis un pion
    // ============================================================
    function getPlayerNameFromPion(pionElement) {
        try {
            // Vérifier si on a déjà le nom dans l'attribut data
            const cachedName = pionElement.getAttribute('data-player-name');
            if (cachedName) {
                return cachedName;
            }

            // Chercher l'élément avec la classe "info_a_afficher"
            const infoElement = pionElement.querySelector('.info_a_afficher');

            if (infoElement && infoElement.textContent) {
                const playerName = infoElement.textContent.trim();
                // Mettre en cache le nom pour éviter les recherches répétées
                pionElement.setAttribute('data-player-name', playerName);
                return playerName;
            }
        } catch (error) {
            debugLog('❌ Erreur lors de l\'extraction du nom du joueur:', error);
        }

        return null;
    }

    // ============================================================
    // FONCTION : Vérifier si une image existe (404 ou non) - AVEC CACHE
    // ============================================================
    function imageExists(url, playerName) {
        return new Promise((resolve) => {
            // Vérifier le cache d'abord
            if (avatarUrlCache.has(playerName)) {
                const cached = avatarUrlCache.get(playerName);
                resolve(cached.exists);
                return;
            }

            const img = new Image();
            img.onload = () => {
                avatarUrlCache.set(playerName, { url: url, exists: true });
                resolve(true);
            };
            img.onerror = () => {
                avatarUrlCache.set(playerName, { url: url, exists: false });
                resolve(false);
            };
            img.src = url;
        });
    }

    // ============================================================
    // FONCTION : Vérifier si un avatar est toujours présent et valide
    // ============================================================
    function isAvatarStillValid(pionElement) {
        const iconElement = pionElement.querySelector('.le_icon_perso');
        if (!iconElement) return false;

        const avatarImg = iconElement.querySelector('.custom-avatar-img');
        if (!avatarImg) return false;

        // Vérifier si l'image est toujours visible et attachée au DOM
        const isAttached = avatarImg.parentElement !== null;
        const isVisible = avatarImg.style.display !== 'none' && avatarImg.style.visibility !== 'hidden' && avatarImg.style.opacity !== '0';

        return isAttached && isVisible;
    }

    // ============================================================
    // FONCTION : Appliquer l'avatar personnalisé à un pion
    // ============================================================
    async function applyCustomAvatar(pionElement, force = false) {
        try {
            // Vérifier si les avatars sont activés
            if (!loadAvatarEnabled()) {
                return;
            }

            // Vérifier le cache pour éviter les réapplications inutiles
            const cacheKey = pionElement;
            const cachedStatus = avatarCache.get(cacheKey);

            // Si l'avatar a déjà été appliqué avec succès et est toujours valide, ne rien faire
            if (!force && cachedStatus === 'success' && isAvatarStillValid(pionElement)) {
                return;
            }

            // Si l'avatar a échoué précédemment et qu'on ne force pas, ne pas réessayer
            if (!force && cachedStatus === 'failed') {
                return;
            }

            // Extraire le nom du joueur
            const playerName = getPlayerNameFromPion(pionElement);

            if (!playerName) {
                avatarCache.set(cacheKey, 'failed');
                return;
            }

            // Construire l'URL de l'avatar
            const avatarUrl = CONFIG.avatarBaseUrl + encodeURIComponent(playerName) + '.png';

            // Vérifier si l'avatar existe (avec cache)
            if (!avatarUrlCache.has(playerName) || force) {
                const exists = await imageExists(avatarUrl, playerName);

                if (!exists) {
                    avatarCache.set(cacheKey, 'failed');
                    pionElement.setAttribute('data-avatar-applied', 'failed');
                    return;
                }
            } else if (!avatarUrlCache.get(playerName).exists) {
                // Avatar déjà vérifié et n'existe pas
                return;
            }

            // Trouver l'élément le_icon_perso où on va insérer l'avatar
            const iconElement = pionElement.querySelector('.le_icon_perso');

            if (!iconElement) {
                return;
            }

            // Chercher si l'avatar existe déjà
            let avatarImg = iconElement.querySelector('.custom-avatar-img');

            if (!avatarImg) {
                // Créer l'élément image pour l'avatar
                avatarImg = document.createElement('img');
                avatarImg.className = 'custom-avatar-img';
                avatarImg.src = avatarUrl;
                avatarImg.alt = playerName;

                // Empêcher le navigateur de cacher l'image
                avatarImg.setAttribute('loading', 'eager');
                avatarImg.setAttribute('decoding', 'sync');

                // Ajouter l'image dans l'élément icon EN PREMIER (pour qu'elle soit au-dessus)
                if (iconElement.firstChild) {
                    iconElement.insertBefore(avatarImg, iconElement.firstChild);
                } else {
                    iconElement.appendChild(avatarImg);
                }
            } else {
                // Si l'avatar existe déjà mais n'est pas visible, le rendre visible
                if (!isAvatarStillValid(pionElement)) {
                    avatarImg.src = avatarUrl; // Forcer le rechargement
                    avatarImg.alt = playerName;
                }
            }

            // Style ULTRA-RENFORCÉ pour rendre l'avatar circulaire et TOUJOURS visible
            // Utilisation de setProperty avec priority 'important' pour forcer les styles
            avatarImg.style.setProperty('width', '100%', 'important');
            avatarImg.style.setProperty('height', '100%', 'important');
            avatarImg.style.setProperty('object-fit', 'cover', 'important');
            avatarImg.style.setProperty('border-radius', '50%', 'important');
            avatarImg.style.setProperty('border', '2px solid rgba(255, 255, 255, 0.8)', 'important');
            avatarImg.style.setProperty('box-shadow', '0 2px 8px rgba(0, 0, 0, 0.3)', 'important');
            avatarImg.style.setProperty('position', 'absolute', 'important');
            avatarImg.style.setProperty('top', '0', 'important');
            avatarImg.style.setProperty('left', '0', 'important');
            avatarImg.style.setProperty('z-index', '999', 'important'); // Z-index très élevé
            avatarImg.style.setProperty('pointer-events', 'none', 'important');
            avatarImg.style.setProperty('display', 'block', 'important');
            avatarImg.style.setProperty('visibility', 'visible', 'important');
            avatarImg.style.setProperty('opacity', '1', 'important');
            avatarImg.style.setProperty('transition', 'none', 'important'); // Désactiver les transitions
            avatarImg.style.setProperty('animation', 'none', 'important'); // Désactiver les animations

            // Forcer le rechargement de l'image si elle n'est pas chargée
            if (!avatarImg.complete || avatarImg.naturalHeight === 0) {
                avatarImg.src = avatarImg.src; // Force reload
            }

            // Marquer ce pion comme traité avec succès
            pionElement.setAttribute('data-avatar-applied', 'success');
            pionElement.setAttribute('data-player-name', playerName);
            avatarCache.set(cacheKey, 'success');

        } catch (error) {
            debugLog('❌ Erreur lors de l\'application de l\'avatar:', error);
            avatarCache.set(pionElement, 'failed');
        }
    }

    // ============================================================
    // FONCTION : Supprimer les avatars personnalisés
    // ============================================================
    function removeCustomAvatars() {
        const avatarImages = document.querySelectorAll('.custom-avatar-img');

        avatarImages.forEach(img => {
            img.remove();
        });

        // Réinitialiser les marqueurs et le cache
        const pions = document.querySelectorAll('.icon_perso');
        pions.forEach(pion => {
            pion.removeAttribute('data-avatar-applied');
            pion.removeAttribute('data-player-name');
        });

        avatarCache.clear();

        debugLog('✅ Avatars personnalisés supprimés');
    }

    // ============================================================
    // FONCTION : Appliquer les avatars à tous les pions visibles (VERSION SYNCHRONE)
    // ============================================================
    function applyAvatarsToAllPionsSync(force = false) {
        if (!loadAvatarEnabled()) {
            return;
        }

        const pions = document.querySelectorAll('.personnages .icon_perso');

        pions.forEach(pion => {
            // Vérifier rapidement si l'avatar est déjà là
            if (!force && isAvatarStillValid(pion)) {
                return; // Avatar déjà présent et valide, ne rien faire
            }

            // Si l'avatar n'est pas là, le réappliquer immédiatement (sans await)
            applyCustomAvatar(pion, force);
        });
    }

    // ============================================================
    // FONCTION : Appliquer les avatars à tous les pions visibles (VERSION ASYNC)
    // ============================================================
    async function applyAvatarsToAllPions(force = false) {
        if (!loadAvatarEnabled()) {
            removeCustomAvatars();
            return;
        }

        const pions = document.querySelectorAll('.personnages .icon_perso');

        debugLog(`🔍 ${pions.length} pion(s) trouvé(s) sur la carte`);

        for (const pion of pions) {
            await applyCustomAvatar(pion, force);
        }
    }

    // ============================================================
    // FONCTION : Réapplication plus rapide avec requestAnimationFrame  (évite les clignotements)
    // ============================================================
    function ultraFastReapplication() {
        const now = Date.now();

        // Limiter à environ 60 FPS pour ne pas surcharger le navigateur
        if (now - lastReapplyTime < 16) {
            reapplyAnimationFrameId = requestAnimationFrame(ultraFastReapplication);
            return;
        }

        lastReapplyTime = now;

        if (loadAvatarEnabled()) {
            // Réappliquer de manière synchrone (sans await) pour être ultra-rapide
            applyAvatarsToAllPionsSync(false);
        }

        // Continuer la boucle
        reapplyAnimationFrameId = requestAnimationFrame(ultraFastReapplication);
    }

    // ============================================================
    // FONCTION : Réappliquer périodiquement les avatars (VERSION HYBRIDE)
    // ============================================================
    function startPeriodicReapplication() {
        // Arrêter les intervalles/animations existants
        if (reapplyIntervalId) {
            clearInterval(reapplyIntervalId);
        }
        if (reapplyAnimationFrameId) {
            cancelAnimationFrame(reapplyAnimationFrameId);
        }

        debugLog('🔄 Démarrage du système de réapplication ULTRA-RAPIDE (50ms + RAF)');

        // APPROCHE HYBRIDE :
        // 1. setInterval de 50ms pour les vérifications régulières
        reapplyIntervalId = setInterval(() => {
            if (loadAvatarEnabled()) {
                applyAvatarsToAllPionsSync(false);
            }
        }, CONFIG.reapplyInterval);

        // 2. requestAnimationFrame pour une réactivité maximale synchronisée avec le navigateur
        ultraFastReapplication();
    }

    // ============================================================
    // FONCTION : Arrêter la réapplication périodique
    // ============================================================
    function stopPeriodicReapplication() {
        if (reapplyIntervalId) {
            clearInterval(reapplyIntervalId);
            reapplyIntervalId = null;
        }
        if (reapplyAnimationFrameId) {
            cancelAnimationFrame(reapplyAnimationFrameId);
            reapplyAnimationFrameId = null;
        }
        debugLog('⏹️ Système de réapplication arrêté');
    }

    // ============================================================
    // FONCTION : Appliquer la taille aux avatars/pions
    // ============================================================
    function applyAvatarSize(size) {
        // Calcul de l'échelle (1 = 100%)
        const scale = size / 100;

        // Créer ou mettre à jour le style CSS personnalisé
        let styleElement = document.getElementById('dreadcast-avatar-resize-style');

        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'dreadcast-avatar-resize-style';
            document.head.appendChild(styleElement);
        }

        // Application du CSS avec transform: scale()
        // Ciblage des pions de joueurs (icon_perso et le_icon_perso)
        styleElement.textContent = `
            /* Redimensionnement des pions de joueurs */
            .personnages .icon_perso {
                transform: scale(${scale}) !important;
                transform-origin: center center !important;
            }

            /* Ajustement du conteneur interne */
            .personnages .icon_perso .le_icon_perso {
                transform: scale(1) !important;
                position: relative !important;
            }

            /* Assurer que les pions restent cliquables */
            .personnages .icon_perso {
                z-index: auto !important;
            }

            /* Style pour les avatars personnalisés - ULTRA-RENFORCÉ */
            .custom-avatar-img {
                pointer-events: none !important;
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                border-radius: 50% !important;
                border: 2px solid rgba(255, 255, 255, 0.8) !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                z-index: 999 !important;
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                transition: none !important;
                animation: none !important;
                transform: none !important;
                will-change: auto !important;
            }

            /* Forcer l'ordre d'empilement */
            .personnages .icon_perso .le_icon_perso > * {
                position: relative !important;
            }

            .personnages .icon_perso .le_icon_perso > .custom-avatar-img {
                z-index: 999 !important;
            }

            /* Empêcher le SVG de passer devant */
            .personnages .icon_perso .le_icon_perso > svg,
            .personnages .icon_perso .le_icon_perso > use {
                z-index: 1 !important;
            }
        `;
    }

    // ============================================================
    // FONCTION : Créer le panneau de configuration (avec lazy loading)
    // ============================================================
    function createConfigPanel() {
        // Vérifier si le panneau existe déjà
        let panel = document.getElementById('dreadcast-avatar-config-panel');
        if (panel) {
            return panel;
        }

        // Créer le panneau HTML avec styles inline forcés
        panel = document.createElement('div');
        panel.id = 'dreadcast-avatar-config-panel';

        // Overlay avec fond noir semi-transparent élégant
        panel.setAttribute('style', `
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background-color: rgba(0, 0, 0, 0.7) !important;
            z-index: 999999 !important;
            display: none !important;
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
        `.replace(/\s+/g, ' ').trim());

        // Panneau
        panel.innerHTML = `
            <div class="dataBox" style="position: fixed !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; z-index: 1000000 !important; width: 500px !important; background: #ffffff !important; border-radius: 12px !important; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important; display: block !important; visibility: visible !important; opacity: 1 !important; overflow: hidden !important;">
                <relative>
                    <div class="head" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; padding: 20px !important; cursor: move !important; position: relative !important;">
                        <div class="title" style="color: #ffffff !important; font-size: 18px !important; font-weight: 600 !important; text-align: center !important; margin: 0 !important;">⚡ Configuration des Avatars (v2.2)</div>
                        <div title="Fermer" class="close" id="avatar-close-btn" style="position: absolute !important; top: 15px !important; right: 15px !important; color: #ffffff !important; cursor: pointer !important; font-size: 24px !important; line-height: 24px !important; width: 32px !important; height: 32px !important; text-align: center !important; background: rgba(255, 255, 255, 0.2) !important; border-radius: 6px !important; transition: all 0.3s ease !important; display: flex !important; align-items: center !important; justify-content: center !important;">✕</div>
                    </div>
                    <div class="content" style="padding: 30px !important; background: #ffffff !important;">
                        <!-- Checkbox pour activer/désactiver les avatars -->
                        <div style="margin-bottom: 25px !important; padding: 18px !important; background: linear-gradient(135deg, #f6f8fb 0%, #eef2f7 100%) !important; border-left: 4px solid #667eea !important; border-radius: 8px !important;">
                            <label style="display: flex !important; align-items: center !important; cursor: pointer !important; user-select: none !important;">
                                <input type="checkbox" id="avatar-enabled-checkbox" style="width: 20px !important; height: 20px !important; margin-right: 12px !important; cursor: pointer !important; accent-color: #667eea !important;">
                                <span style="font-size: 15px !important; color: #2d3748 !important; font-weight: 500 !important;">
                                    🖼️ Afficher les avatars des joueurs
                                </span>
                            </label>
                            <div style="margin-top: 10px !important; font-size: 12px !important; color: #718096 !important; padding-left: 32px !important;">
                                Remplace l'icône par défaut par l'avatar réel de chaque joueur
                            </div>
                        </div>

                        <!-- Slider de taille -->
                        <div style="margin-bottom: 25px !important;">
                            <label style="display: block !important; margin-bottom: 15px !important; font-size: 15px !important; color: #2d3748 !important; font-weight: 500 !important;">
                                📏 Taille des pions : <span id="avatar-size-value" style="color: #667eea !important; font-weight: 700 !important; font-size: 16px !important;">100%</span>
                            </label>
                            <input type="range" id="avatar-size-slider" min="${CONFIG.minSize}" max="${CONFIG.maxSize}" value="100"
                                   style="width: 100% !important; height: 6px !important; background: linear-gradient(to right, #e2e8f0, #667eea) !important; border-radius: 10px !important; outline: none !important; cursor: pointer !important; -webkit-appearance: none !important; appearance: none !important;">
                            <style>
                                #avatar-size-slider::-webkit-slider-thumb {
                                    -webkit-appearance: none !important;
                                    appearance: none !important;
                                    width: 20px !important;
                                    height: 20px !important;
                                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                                    border-radius: 50% !important;
                                    cursor: pointer !important;
                                    box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4) !important;
                                    transition: all 0.3s ease !important;
                                }
                                #avatar-size-slider::-webkit-slider-thumb:hover {
                                    transform: scale(1.2) !important;
                                    box-shadow: 0 3px 10px rgba(102, 126, 234, 0.6) !important;
                                }
                                #avatar-size-slider::-moz-range-thumb {
                                    width: 20px !important;
                                    height: 20px !important;
                                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
                                    border: none !important;
                                    border-radius: 50% !important;
                                    cursor: pointer !important;
                                    box-shadow: 0 2px 6px rgba(102, 126, 234, 0.4) !important;
                                    transition: all 0.3s ease !important;
                                }
                                #avatar-size-slider::-moz-range-thumb:hover {
                                    transform: scale(1.2) !important;
                                    box-shadow: 0 3px 10px rgba(102, 126, 234, 0.6) !important;
                                }
                                #avatar-close-btn:hover {
                                    background: rgba(255, 255, 255, 0.3) !important;
                                    transform: rotate(90deg) !important;
                                }
                                #avatar-reset-btn:hover {
                                    background: linear-gradient(135deg, #5568d3 0%, #6a3f8f 100%) !important;
                                    transform: translateY(-2px) !important;
                                    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4) !important;
                                }
                            </style>
                        </div>

                        <!-- Informations -->
                        <div style="margin-top: 25px !important; padding: 18px !important; background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%) !important; border-left: 4px solid #ff9800 !important; border-radius: 8px !important; font-size: 13px !important; color: #4a5568 !important; line-height: 1.6 !important;">
                            <strong style="color: #e65100 !important; display: block !important; margin-bottom: 8px !important;">⚡ NOUVEAU dans v2.2 - ANTI-CLIGNOTEMENT :</strong>
                            • Intervalle réduit de 500ms → <strong>50ms</strong> (10x plus rapide !)<br>
                            • <strong>requestAnimationFrame</strong> pour synchronisation parfaite avec le navigateur<br>
                            • Approche hybride : setInterval + RAF pour éliminer le clignotement<br>
                            • Cache d'URL d'avatars pour performances maximales<br>
                            • Styles CSS ultra-renforcés avec z-index: 999<br>
                            • Application synchrone pour réactivité instantanée
                        </div>

                        <!-- Boutons -->
                        <div style="margin-top: 25px !important; text-align: center !important; display: flex !important; gap: 10px !important; justify-content: center !important;">
                            <button id="avatar-reset-btn" style="padding: 12px 30px !important; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; color: #ffffff !important; border: none !important; border-radius: 8px !important; cursor: pointer !important; font-size: 14px !important; font-weight: 600 !important; transition: all 0.3s ease !important; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3) !important;">
                                🔄 Réinitialiser
                            </button>
                        </div>
                    </div>
                </relative>
            </div>
        `;

        // Fermeture au clic sur le fond (overlay)
        panel.addEventListener('click', function(e) {
            if (e.target === panel) {
                panel.setAttribute('style', panel.getAttribute('style').replace('display: block !important;', 'display: none !important;'));
            }
        });

        // Ajouter le panneau au body
        if (!document.body) {
            setTimeout(function() {
                if (document.body) {
                    document.body.appendChild(panel);
                }
            }, 500);
        } else {
            document.body.appendChild(panel);
        }

        // Attacher les événements
        setTimeout(function() {
            const closeBtn = document.getElementById('avatar-close-btn');
            const slider = document.getElementById('avatar-size-slider');
            const valueDisplay = document.getElementById('avatar-size-value');
            const resetBtn = document.getElementById('avatar-reset-btn');
            const avatarCheckbox = document.getElementById('avatar-enabled-checkbox');

            if (!closeBtn || !slider || !valueDisplay || !resetBtn || !avatarCheckbox) {
                debugLog('❌ Erreur : Éléments du panneau introuvables');
                return;
            }

            // Charger les préférences actuelles
            const currentSize = loadAvatarSize();
            const avatarsEnabled = loadAvatarEnabled();

            slider.value = currentSize;
            valueDisplay.textContent = currentSize + '%';
            avatarCheckbox.checked = avatarsEnabled;

            // Événement : Bouton fermer
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                panel.setAttribute('style', panel.getAttribute('style').replace('display: block !important;', 'display: none !important;'));
            });

            // Événement : Changement de valeur du slider
            slider.addEventListener('input', function() {
                const size = parseInt(this.value);
                valueDisplay.textContent = size + '%';
                applyAvatarSize(size);
                saveAvatarSize(size);
            });

            // Événement : Checkbox avatars
            avatarCheckbox.addEventListener('change', function() {
                const enabled = this.checked;
                saveAvatarEnabled(enabled);

                if (enabled) {
                    debugLog('🖼️ Activation des avatars...');
                    startPeriodicReapplication();
                    applyAvatarsToAllPions(true); // true = forcer la réapplication
                } else {
                    debugLog('🚫 Désactivation des avatars...');
                    stopPeriodicReapplication();
                    removeCustomAvatars();
                }
            });

            // Événement : Bouton réinitialiser
            resetBtn.addEventListener('click', function() {
                slider.value = CONFIG.defaultSize;
                valueDisplay.textContent = CONFIG.defaultSize + '%';
                avatarCheckbox.checked = true;

                applyAvatarSize(CONFIG.defaultSize);
                saveAvatarSize(CONFIG.defaultSize);
                saveAvatarEnabled(true);

                // Effacer les caches
                avatarCache.clear();
                avatarUrlCache.clear();

                startPeriodicReapplication();
                applyAvatarsToAllPions(true);
            });

            // Rendre le panneau draggable (déplaçable)
            const dataBox = panel.querySelector('.dataBox');
            const head = panel.querySelector('.head');
            if (dataBox && head) {
                makeDraggable(dataBox, head);
            }
        }, 100);

        return panel;
    }

    // ============================================================
    // FONCTION : Ouvrir le panneau de configuration
    // ============================================================
    function openConfigPanel() {
        let panel = document.getElementById('dreadcast-avatar-config-panel');

        // Créer le panneau s'il n'existe pas (lazy loading)
        if (!panel) {
            panel = createConfigPanel();
        }

        if (panel) {
            // Afficher le panneau
            panel.setAttribute('style', panel.getAttribute('style').replace('display: none !important;', 'display: block !important;'));
            debugLog('✅ Panneau de configuration ouvert');
        } else {
            debugLog('❌ Erreur : Impossible de créer le panneau');
        }
    }

    // ============================================================
    // FONCTION : Rendre un élément draggable (déplaçable)
    // ============================================================
    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.transform = 'none'; // Désactiver le centrage pendant le déplacement
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    // ============================================================
    // FONCTION : Ajouter l'option dans le menu Paramètres
    // ============================================================
    function addMenuOption() {
        // Attendre que le menu soit chargé
        const checkMenu = setInterval(function() {
            const parametresMenu = document.querySelector('.parametres ul');

            if (parametresMenu) {
                clearInterval(checkMenu);

                // Vérifier si l'option existe déjà
                if (document.getElementById('avatar-resize-menu-option')) {
                    return;
                }

                // Créer la nouvelle option de menu
                const menuOption = document.createElement('li');
                menuOption.id = 'avatar-resize-menu-option';
                menuOption.className = 'link couleur2';
                menuOption.innerHTML = '⚡ Configuration Avatars (v2.2)';
                menuOption.style.cursor = 'pointer';

                // Événement : Ouvrir le panneau de configuration
                menuOption.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openConfigPanel();
                }, true);

                // Ajouter l'option au menu (avant le dernier séparateur)
                const lastSeparator = parametresMenu.querySelector('.separator:last-of-type');
                if (lastSeparator) {
                    parametresMenu.insertBefore(menuOption, lastSeparator);
                } else {
                    parametresMenu.appendChild(menuOption);
                }

                debugLog('✅ Option "Configuration Avatars (v2.2)" ajoutée au menu Paramètres');
            }
        }, 500);

        // Arrêter la vérification après 10 secondes
        setTimeout(function() {
            clearInterval(checkMenu);
        }, 10000);
    }

    // ============================================================
    // FONCTION : Observer les changements du DOM (VERSION ULTRA-RÉACTIVE)
    // ============================================================
    function observeMapChanges() {
        // Observer les changements dans la zone de la carte
        const targetNode = document.querySelector('.personnages');

        if (targetNode) {
            const observer = new MutationObserver(function(mutations) {
                debugLog('🔍 MutationObserver: Changement détecté', mutations.length, 'mutation(s)');

                // Réappliquer la taille quand de nouveaux pions apparaissent
                const currentSize = loadAvatarSize();
                applyAvatarSize(currentSize);

                // Réapplication immédiate et synchrone (sans await) pour être ultra-rapide
                mutations.forEach(mutation => {
                    // Nouveaux nœuds ajoutés
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && node.classList && node.classList.contains('icon_perso')) {
                            debugLog('🆕 Nouveau pion détecté, application immédiate de l\'avatar...');
                            applyCustomAvatar(node, true); // true = forcer
                        }
                    });

                    // Modifications du DOM qui pourraient indiquer une réinitialisation du pion
                    if (mutation.type === 'childList') {
                        const target = mutation.target;
                        const pionElement = target.classList && target.classList.contains('icon_perso')
                            ? target
                            : target.closest('.icon_perso');

                        if (pionElement && !isAvatarStillValid(pionElement)) {
                            debugLog('⚠️ Pion modifié sans avatar, réapplication immédiate...');
                            applyCustomAvatar(pionElement, true);
                        }
                    }
                });
            });

            // Configuration de l'observation : surveiller TOUT de manière très agressive
            observer.observe(targetNode, {
                childList: true,      // Surveiller l'ajout/suppression de nœuds enfants
                subtree: true,        // Surveiller tous les descendants
                attributes: true,     // Surveiller les modifications d'attributs
                attributeOldValue: true,
                characterData: true,
                characterDataOldValue: true
            });

            debugLog('✅ MutationObserver activé (mode ultra-réactif)');
        }
    }

    // ============================================================
    // INITIALISATION
    // ============================================================
    function init() {
        debugLog('⚡ Dreadcast PimpMyPion - Script chargé');

        // 1. Charger et appliquer la taille sauvegardée
        const savedSize = loadAvatarSize();
        applyAvatarSize(savedSize);
        debugLog('✅ Taille des avatars appliquée:', savedSize + '%');

        // 2. Ajouter l'option dans le menu Paramètres
        addMenuOption();

        // 3. Observer les changements de la carte (version ultra-réactive)
        observeMapChanges();

        // 4. Appliquer les avatars personnalisés au chargement
        setTimeout(() => {
            debugLog('🖼️ Application des avatars personnalisés au chargement...');
            applyAvatarsToAllPions(true); // true = forcer la première application

            // 5. Démarrer le système de réapplication ULTRA-RAPIDE (50ms + RAF)
            if (loadAvatarEnabled()) {
                startPeriodicReapplication();
            }
        }, 2000);

        // 6. Réapplication supplémentaire après 5 secondes (pour s'assurer que tout est bien chargé)
        setTimeout(() => {
            debugLog('🔄 Réapplication de sécurité après 5 secondes...');
            applyAvatarsToAllPions(true);
        }, 5000);
    }

    // Démarrer l'initialisation quand le DOM est prêt
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

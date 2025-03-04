'use strict';

/**
 * Configuration for controlling the visibility of buttons in the MiroTalk P2P client.
 * Set properties to true to show the corresponding buttons, or false to hide them.
 * captionBtn, showSwapCameraBtn, showScreenShareBtn, showFullScreenBtn, showVideoPipBtn, showDocumentPipBtn -> (auto-detected).
 */
let buttons = {
    main: {
        showShareRoomBtn: false, // For guests
        showHideMeBtn: false,
        showAudioBtn: true,
        showVideoBtn: true,
        showScreenBtn: false, // autodetected
        showRecordStreamBtn: false,
        showChatRoomBtn: false,
        showCaptionRoomBtn: false,
        showRoomEmojiPickerBtn: false,
        showMyHandBtn: false,
        showWhiteboardBtn: false,
        showSnapshotRoomBtn: false,
        showFileShareBtn: false,
        showDocumentPipBtn: false,
        showMySettingsBtn: true,
        showAboutBtn: false, // Please keep me always true, Thank you!
    },
    chat: {
        showTogglePinBtn: false,
        showMaxBtn: false,
        showSaveMessageBtn: false,
        showMarkDownBtn: false,
        showChatGPTBtn: false,
        showFileShareBtn: false,
        showShareVideoAudioBtn: false,
        showParticipantsBtn: false,
    },
    caption: {
        showTogglePinBtn: false,
        showMaxBtn: false,
    },
    settings: {
        showMicOptionsBtn: true,
        showTabRoomPeerName: true,
        showTabRoomParticipants: true,
        showTabRoomSecurity: true,
        showTabEmailInvitation: true,
        showCaptionEveryoneBtn: true,
        showMuteEveryoneBtn: true,
        showHideEveryoneBtn: true,
        showEjectEveryoneBtn: true,
        showLockRoomBtn: true,
        showUnlockRoomBtn: true,
        showShortcutsBtn: true,
    },
    remote: {
        showAudioVolume: false,
        audioBtnClickAllowed: false,
        videoBtnClickAllowed: false,
        showVideoPipBtn: false,
        showKickOutBtn: false,
        showSnapShotBtn: false,
        showFileShareBtn: false,
        showShareVideoAudioBtn: false,
        showPrivateMessageBtn: false,
        showZoomInOutBtn: false,
        showVideoFocusBtn: false,
    },
    local: {
        showVideoPipBtn: false,
        showSnapShotBtn: true,
        showVideoCircleBtn: false,
        showZoomInOutBtn: false,
    },
    whiteboard: {
        whiteboardLockBtn: false,
    },
};

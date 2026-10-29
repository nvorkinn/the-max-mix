import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.VirtualKeyboard

Window {
    id: root

    property string page: "list"
    property bool hiddenMode: false
    property string pickedSsid: ""
    property string pickedSecurity: "psk"
    readonly property string ssid: hiddenMode ? ssidField.text.trim() : pickedSsid

    width: 1024
    height: 600
    visible: true
    visibility: windowed ? Window.Windowed : Window.FullScreen
    color: "#101210"
    title: "Wi-Fi setup"

    function openJoin(name, security, hidden) {
        backend.clearError()
        pickedSsid = name
        pickedSecurity = security
        hiddenMode = hidden
        ssidField.text = ""
        passwordField.text = ""
        page = "join"
        (hidden ? ssidField : passwordField).forceActiveFocus()
    }

    function pick(network) {
        if (network.security === "open") {
            backend.connectTo(network.ssid, "", false, "open")
        } else {
            openJoin(network.ssid, network.security, false)
        }
    }

    function submit() {
        if (root.ssid.length === 0 || (!hiddenMode && passwordField.text.length === 0)) {
            return
        }
        Qt.inputMethod.hide()
        backend.connectTo(root.ssid, passwordField.text, hiddenMode, pickedSecurity)
    }

    function back() {
        Qt.inputMethod.hide()
        backend.clearError()
        page = "list"
    }

    // The card lives in the part of the screen the keyboard leaves free, so the fields never end up underneath it.
    Item {
        id: area

        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: inputPanel.active ? inputPanel.y : root.height

        Rectangle {
            id: card

            anchors.centerIn: parent
            width: Math.min(920, parent.width - 32)
            height: root.page === "list" ? parent.height - 32 : Math.min(parent.height - 16, joinColumn.implicitHeight + 40)
            radius: 16
            color: "#181c18"

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 20
                spacing: 12
                visible: root.page === "list"

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    Text {
                        Layout.fillWidth: true
                        text: "Choose a Wi-Fi network"
                        color: "#e6ebe6"
                        font.pixelSize: 30
                        elide: Text.ElideRight
                    }
                    BusyIndicator {
                        running: backend.scanning
                        visible: backend.scanning
                        implicitWidth: 40
                        implicitHeight: 40
                        palette.dark: "#3a8a55"
                    }
                    PanelButton {
                        text: "Other…"
                        onClicked: root.openJoin("", "psk", true)
                    }
                    PanelButton {
                        text: "Refresh"
                        enabled: !backend.scanning
                        onClicked: backend.refresh()
                    }
                    PanelButton {
                        text: "Cancel"
                        visible: backend.canCancel
                        onClicked: backend.cancel()
                    }
                }

                Text {
                    Layout.fillWidth: true
                    visible: backend.error.length > 0
                    text: backend.error
                    color: "#e57373"
                    font.pixelSize: 22
                    wrapMode: Text.WordWrap
                }

                ListView {
                    id: networkList

                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    visible: count > 0 || backend.scanning
                    clip: true
                    spacing: 8
                    model: backend.networks
                    boundsBehavior: Flickable.StopAtBounds
                    ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

                    delegate: Rectangle {
                        id: row

                        required property var modelData
                        readonly property bool usable: modelData.security !== "unsupported"

                        width: networkList.width
                        height: 72
                        radius: 10
                        color: tap.pressed && usable ? "#2a322a" : "#202520"
                        opacity: usable ? 1 : 0.45

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: 20
                            anchors.rightMargin: 20
                            spacing: 16

                            Text {
                                Layout.fillWidth: true
                                text: modelData.ssid
                                color: "#e6ebe6"
                                font.pixelSize: 26
                                elide: Text.ElideRight
                            }
                            Text {
                                visible: !usable
                                text: "Not supported"
                                color: "#8a948a"
                                font.pixelSize: 18
                            }
                            Item {
                                visible: modelData.security === "psk"
                                implicitWidth: 20
                                implicitHeight: 26

                                Rectangle {
                                    x: 4
                                    width: 12
                                    height: 16
                                    radius: 6
                                    color: "transparent"
                                    border.width: 3
                                    border.color: "#8a948a"
                                }
                                Rectangle {
                                    y: 11
                                    width: 20
                                    height: 15
                                    radius: 3
                                    color: "#8a948a"
                                }
                            }
                            Row {
                                spacing: 3

                                Repeater {
                                    model: 4

                                    Rectangle {
                                        required property int index

                                        anchors.bottom: parent.bottom
                                        width: 6
                                        height: 8 + index * 6
                                        radius: 2
                                        color: index < row.modelData.bars ? "#5fbf7f" : "#3a423a"
                                    }
                                }
                            }
                        }

                        MouseArea {
                            id: tap

                            anchors.fill: parent
                            enabled: usable
                            onClicked: root.pick(modelData)
                        }
                    }

                }

                Text {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    visible: networkList.count === 0 && !backend.scanning
                    text: "No networks found. Tap Refresh to scan again."
                    color: "#8a948a"
                    font.pixelSize: 22
                    verticalAlignment: Text.AlignVCenter
                    horizontalAlignment: Text.AlignHCenter
                }
            }

            ColumnLayout {
                id: joinColumn

                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.margins: 20
                spacing: 12
                visible: root.page === "join"

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    PanelButton {
                        text: "Back"
                        onClicked: root.back()
                    }
                    Text {
                        Layout.fillWidth: true
                        text: root.hiddenMode ? "Other network" : "Join " + root.pickedSsid
                        color: "#e6ebe6"
                        font.pixelSize: 28
                        elide: Text.ElideRight
                    }
                }

                PanelField {
                    id: ssidField

                    Layout.fillWidth: true
                    visible: root.hiddenMode
                    placeholderText: "Network name"
                    onAccepted: passwordField.forceActiveFocus()
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    PanelField {
                        id: passwordField

                        Layout.fillWidth: true
                        placeholderText: root.hiddenMode ? "Password (empty if open)" : "Password"
                        echoMode: showPassword.checked ? TextInput.Normal : TextInput.Password
                        inputMethodHints: Qt.ImhSensitiveData | Qt.ImhNoAutoUppercase | Qt.ImhNoPredictiveText
                        onAccepted: root.submit()
                    }
                    PanelButton {
                        id: showPassword

                        checkable: true
                        text: checked ? "Hide" : "Show"
                    }
                    PanelButton {
                        primary: true
                        text: "Connect"
                        enabled: root.ssid.length > 0 && (root.hiddenMode || passwordField.text.length > 0)
                        onClicked: root.submit()
                    }
                }

                Text {
                    Layout.fillWidth: true
                    visible: backend.error.length > 0
                    text: backend.error
                    color: "#e57373"
                    font.pixelSize: 22
                    wrapMode: Text.WordWrap
                }
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        visible: backend.connecting
        color: "#f0101210"

        MouseArea {
            anchors.fill: parent
        }
        ColumnLayout {
            anchors.centerIn: parent
            spacing: 20

            BusyIndicator {
                Layout.alignment: Qt.AlignHCenter
                running: backend.connecting
                implicitWidth: 80
                implicitHeight: 80
                palette.dark: "#5fbf7f"
            }
            Text {
                Layout.alignment: Qt.AlignHCenter
                text: "Connecting to " + (root.page === "list" ? "the network" : root.ssid) + "…"
                color: "#e6ebe6"
                font.pixelSize: 28
            }
        }
    }

    Connections {
        target: backend

        function onConnectingChanged() {
            if (!backend.connecting && root.page === "join") {
                passwordField.forceActiveFocus()
            }
        }
    }

    InputPanel {
        id: inputPanel

        z: 99
        x: 0
        y: active ? root.height - height : root.height
        width: root.width
    }
}

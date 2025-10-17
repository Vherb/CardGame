import React from 'react';
import { Card, Row, Col, Button, Form, InputGroup, Badge } from 'react-bootstrap';
import './game-setup.css';

export default function GameSetup({
  title = 'Game Setup',
  badge = '',
  username = '',
  setUsername,
  stakeText = '',
  setStakeText,
  scBalance = 0,
  currencyLabel = 'SC',
  joinLabel = 'Join Game',
  onJoin,
  joinDisabled = false,
  // New: character picker
  characterId,
  onPickCharacter,
  avatarId,
  avatarGlyph,
  onOpenAvatarModal,
  colors,
  selectedColor,
  onPickColor,
  rightAside,
  children,
  footerExtra,
}) {
  const handleStakeChange = (e) => {
    if (!setStakeText) return;
    const v = e.target.value;
    if (/^\d{0,6}(\.\d{0,2})?$/.test(v) || v === '') setStakeText(v);
  };
  const handleStakeBlur = () => {
    if (!setStakeText) return;
    const n = Math.max(0.01, Number(stakeText) || 0);
    setStakeText(n.toFixed(2));
  };

  return (
    <div className="gs-wrap">
      <div className="gs-top-glow" aria-hidden="true" />
      <Card className="gs-card bg-dark text-light shadow-lg br-12">
        <Card.Header as="h3" className="fw-bold d-flex align-items-center gs-header">
          {title}
          {badge ? (<Badge bg="light" text="dark" className="ms-2">{badge}</Badge>) : null}
        </Card.Header>

        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col xs={12} md={6}>
              <Form.Label className="fw-bold">
                <i className="bi bi-person-badge me-2" /> Screen Name
              </Form.Label>
              <InputGroup size="sm">
                <InputGroup.Text className="bg-dark-subtle text-light border-0">
                  <i className="bi bi-person" />
                </InputGroup.Text>
                <Form.Control
                  type="text"
                  placeholder="Your name"
                  value={username}
                  onChange={(e) => setUsername && setUsername(e.target.value)}
                  className="bg-dark-subtle border-0 text-light"
                  autoComplete="nickname"
                  maxLength={16}
                />
              </InputGroup>
              <div className="small text-white mt-1">This is how other players will see you.</div>
            </Col>

            <Col xs={12} md={6}>
              <Form.Label className="fw-bold">
                <i className="bi bi-coin me-2" /> Stake ({currencyLabel})
              </Form.Label>
              <InputGroup size="sm">
                <InputGroup.Text className="bg-dark-subtle text-light border-0">{currencyLabel}</InputGroup.Text>
                <Form.Control
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 1.00"
                  value={stakeText}
                  onChange={handleStakeChange}
                  onBlur={handleStakeBlur}
                  className="bg-dark-subtle border-0 text-light"
                />
              </InputGroup>
              <div className="small text-white mt-1">
                Balance: <strong>{(Number(scBalance) || 0).toFixed(2)} {currencyLabel}</strong>.
              </div>
            </Col>
          </Row>

          <Row className="g-3 mt-2">
            {/* Character (above Avatar) */}
            {(onPickCharacter) && (
              <Col xs={12}>
                <Form.Label className="fw-bold d-flex align-items-center">
                  <i className="bi bi-robot me-2" /> Character
                </Form.Label>
                <div className="d-flex flex-wrap gap-3 gs-characters">
                  {[
                    { id: 'astronaut', label: 'Astronaut', glyph: '👨‍🚀' },
                    { id: 'alien', label: 'Alien', glyph: '👾' },
                    { id: 'robot4', label: 'Robot 4', glyph: '🤖' },
                  ].map(opt => (
                    <label key={opt.id} className="gs-char-option d-flex align-items-center gap-2" style={{ cursor:'pointer' }}>
                      <input
                        type="radio"
                        name="gs-character"
                        value={opt.id}
                        checked={(characterId || 'astronaut') === opt.id}
                        onChange={() => onPickCharacter && onPickCharacter(opt.id)}
                        className="gs-char-input"
                      />
                      <span className="gs-char-bullet" aria-hidden="true" />
                      <span style={{ fontSize: 20 }}>{opt.glyph}</span>
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </Col>
            )}
            <Col xs={12} md={8}>
              {Array.isArray(colors) && colors.length > 0 ? (
                <>
                  <Form.Label className="fw-bold d-flex align-items-center">
                    <i className="bi bi-palette-fill me-2" /> Color
                    {selectedColor ? (
                      <span className="ms-2 rounded-pill mm-swab" style={{ display:'inline-block', width:18, height:18, background:selectedColor }} />
                    ) : null}
                  </Form.Label>
                  <div className="d-flex flex-wrap gap-2">
                    {colors.map((hex) => (
                      <button key={hex} type="button" className={`sw led-swatch ${selectedColor?.toLowerCase()===hex.toLowerCase()?'is-active':''}`} style={{ width: 44, height: 44, borderRadius: '50%', background: hex }} onClick={() => onPickColor && onPickColor(hex)} aria-label={`Choose ${hex}`}>
                        <span className="led-ring" />
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </Col>

            <Col xs={12} md={4}>
              <Form.Label className="fw-bold d-flex align-items-center">
                <i className="bi bi-emoji-smile me-2" /> Avatar
              </Form.Label>
              <div className="d-flex align-items-center gap-2">
                {avatarGlyph ? (
                  <div className="avatar-xl avatar-ring" aria-label="Your avatar preview" title="Your avatar">
                    {avatarGlyph}
                  </div>
                ) : null}
                {onOpenAvatarModal ? (
                  <Button variant="outline-light" size="sm" className="pill" title="Choose avatar" onClick={onOpenAvatarModal}>
                    Change
                  </Button>
                ) : null}
              </div>
            </Col>
          </Row>

          {children ? (<div className="gs-extra mt-3">{children}</div>) : null}
        </Card.Body>

        <Card.Footer className="bg-transparent border-0 pt-0 pb-3">
          {footerExtra ? (
            <div>
              {footerExtra}
            </div>
          ) : null}
          <div className={`d-grid ${footerExtra ? 'mt-3' : ''}`}>
            <Button
              variant="light"
              className="fw-bold w-100"
              onClick={onJoin}
              disabled={!!joinDisabled}
            >
              <i className="bi bi-play-fill me-1" />
              {joinLabel}
            </Button>
          </div>
        </Card.Footer>
      </Card>
    </div>
  );
}
